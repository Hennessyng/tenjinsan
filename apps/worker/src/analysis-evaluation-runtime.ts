import { randomUUID } from "node:crypto"
import { BookMapPipeline } from "@reading-studio/generation"
import { type ProviderAuthority, ProviderError } from "@reading-studio/providers"
import { LiveStudyGuardError } from "@reading-studio/storage"
import { resolveProductionStage } from "./production-stage.ts"
import { type WorkerRunResult, WorkerRuntime } from "./runtime.ts"

export function analysisEvaluationRuntime(
  authority: ProviderAuthority & { readonly signal?: AbortSignal; readonly clock?: () => Date },
) {
  const { storage } = authority,
    target = storage.liveStudyGuard.target
  if (!target?.purpose || !target.grantId) throw new ProviderError("unauthorized")
  const setup = storage.sources.getSetup(target.setupRevisionId),
    grant = storage.sources.getGrant(target.grantId)
  if (
    !setup?.analysis.purpose ||
    grant?.kind !== "active" ||
    grant.ownerId !== authority.ownerId ||
    grant.installationId !== authority.installationId
  )
    throw new ProviderError("unauthorized")
  storage.liveStudyGuard.assertActive(setup.id)
  const clock = authority.clock ?? (() => new Date())
  const pipeline = new BookMapPipeline(authority)
  const worker = new WorkerRuntime({
    storage,
    clock,
    leaseDurationMs: 120000,
    ...(authority.signal ? { signal: authority.signal } : {}),
    tokenFactory: randomUUID,
    attemptIdFactory: () => randomUUID(),
    resolveStage: (job) => resolveProductionStage({ ...authority, clock }, job),
  })
  const state = () => {
    const pendingJobs = storage.execution.listSetupJobs(setup.id)
    if (pendingJobs.some((job) => job.state === "paused" && job.reason === "outcome_unknown"))
      return { kind: "awaiting-owner" as const }
    if (pendingJobs.some((job) => job.state === "cancelled" || job.cancellationRequested))
      return { kind: "cancelled" as const }
    const analysis = pipeline.prepare(setup.id, grant.id)
    if (analysis.status === "successful" && analysis.wholeBook?.terminal === "verified-analysis")
      return { kind: "verified-analysis" as const, analysis }
    const jobs = storage.execution.listSetupJobs(setup.id)
    if (jobs.some((job) => job.state === "paused" && job.reason === "outcome_unknown"))
      return { kind: "awaiting-owner" as const, analysis }
    if (jobs.some((job) => job.state === "cancelled" || job.cancellationRequested))
      return { kind: "cancelled" as const, analysis }
    if (analysis.wholeBook?.phase === "blocked") return { kind: "blocked" as const, analysis }
    return { kind: "pending" as const, analysis }
  }
  return {
    async step() {
      if (authority.signal?.aborted) return { kind: "stopped" as const }
      const before = state()
      if (before.kind !== "pending") return before
      let result: WorkerRunResult
      try {
        result = await worker.runNext()
      } catch (error) {
        if (error instanceof LiveStudyGuardError && error.code === "outcome-unknown")
          return { kind: "awaiting-owner" as const }
        throw error
      }
      const after = state()
      return result.kind === "idle" && after.kind === "pending"
        ? { ...after, kind: "incomplete" as const }
        : after
    },
  }
}

export async function runAnalysisEvaluation(
  authority: ProviderAuthority & { readonly signal: AbortSignal },
) {
  const runtime = analysisEvaluationRuntime(authority)
  while (!authority.signal.aborted) {
    const result = await runtime.step()
    if (result.kind !== "pending") return result
  }
  return { kind: "stopped" as const }
}
