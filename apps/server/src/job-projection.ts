import { contentDigest, type Job } from "@reading-studio/contracts"
import type { Storage } from "@reading-studio/storage"
import { z } from "zod"

const Usage = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("known"),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
  }),
  z.strictObject({ kind: z.literal("unknown") }),
])
export const OwnerJob = z.strictObject({
  id: z.string(),
  studyId: z.string(),
  sourceRevisionId: z.string(),
  setupRevisionId: z.string(),
  inputRevisionId: z.string(),
  stage: z.string(),
  state: z.string(),
  reason: z.string().nullable(),
  trace_id: z.string().nullable(),
  explanation: z.string().nullable(),
  checkpoint: z.boolean(),
  section: z.strictObject({ index: z.number().int().nonnegative(), id: z.string() }).nullable(),
  cancellationRequested: z.boolean(),
  attempts: z.number().int().nonnegative(),
  retryRemaining: z.number().int().nonnegative(),
  callBudgetRemaining: z.number().int().nonnegative(),
  runBudgetRemaining: z.number().int().nonnegative(),
  usage: Usage,
  failureCode: z.string().nullable(),
  canRetry: z.boolean(),
  unknownAttemptId: z.string().nullable(),
  provider: z.string(),
  model: z.string(),
})
export const OwnerJobs = z.strictObject({
  jobs: z.array(OwnerJob),
  providerCharges: z.literal("not-returned"),
})

const safeFailures = new Set([
  "rate-limited",
  "unavailable",
  "rejected",
  "malformed-output",
  "input-limit",
  "missing-credentials",
  "unauthorized",
  "unsupported-schema",
  "unsupported-model",
  "unsupported-settings",
])

export function projectOwnerJobs(storage: Storage, ownerId: string) {
  const installationId = storage.sources.getInstallation(ownerId)
  const owned = storage.execution.listOwnerJobs(ownerId).filter((job) => {
    const setup = storage.sources.getSetup(job.setupRevisionId)
    return (
      setup &&
      storage.sources.getLatestSetup(setup.studyId)?.id === setup.id &&
      job.grant.ownerId === ownerId &&
      job.grant.installationId === installationId &&
      storage.sources.getGrant(job.grant.id)?.kind === "active"
    )
  })
  const callCounts = new Map<string, number>()
  for (const job of owned) {
    callCounts.set(
      job.setupRevisionId,
      (callCounts.get(job.setupRevisionId) ?? 0) + storage.execution.listAttempts(job.runId).length,
    )
  }
  return OwnerJobs.parse({
    providerCharges: "not-returned",
    jobs: owned.map((job) =>
      projectOwnerJob(storage, job, callCounts.get(job.setupRevisionId) ?? 0),
    ),
  })
}

function projectOwnerJob(storage: Storage, job: Job, setupCalls: number) {
  const pause = storage.execution.providerPause(job.id)
  const setup = storage.sources.getSetup(job.setupRevisionId)
  if (!setup) throw new TypeError("Job setup missing")
  const run = storage.execution.getRun(job.runId)
  if (!run) throw new TypeError("Job run missing")
  const attempts = storage.execution.listAttempts(job.runId)
  const unknown = attempts.find(
    (attempt) => attempt.state === "outcome_unknown" && attempt.resolution === "awaiting-owner",
  )
  const retryRemaining = Math.max(
    0,
    run.budget.maxTransientRetries -
      attempts.filter((attempt) => attempt.state === "response-received" && attempt.retryApproved)
        .length,
  )
  const last = attempts.at(-1)
  const outline = job.stage === "lesson" ? storage.outlines.approved(job.inputRevisionId) : null
  const base = outline
    ? `lesson-${contentDigest(JSON.stringify([outline.id, job.setupRevisionId, job.grant.id]))}`
    : null
  const sectionIndex =
    base && job.id === base
      ? 0
      : base && job.id.startsWith(`${base}-`)
        ? Number(job.id.slice(base.length + 1))
        : -1
  const section =
    outline && Number.isInteger(sectionIndex) && sectionIndex >= 0
      ? outline.sections[sectionIndex]
      : undefined
  const usage = attempts.some(
    (attempt) =>
      attempt.state === "dispatching" || ("usage" in attempt && attempt.usage.kind === "unknown"),
  )
    ? { kind: "unknown" as const }
    : job.usage
  return {
    id: job.id,
    studyId: setup.studyId,
    sourceRevisionId: setup.analysis.normalizationRevisionId,
    setupRevisionId: job.setupRevisionId,
    inputRevisionId: job.inputRevisionId,
    stage: job.stage,
    state: job.state,
    reason: job.state === "paused" ? job.reason : null,
    trace_id: pause?.trace_id ?? null,
    explanation: pause
      ? pause.code === "output-limit"
        ? "Reply exceeded the studio output-token cap. No automatic replay."
        : "Provider access was rejected or its route or usage limit is unavailable. Check your connection before approving new work. No automatic replay or provider switch."
      : null,
    checkpoint: job.checkpoint !== null,
    section: section ? { index: sectionIndex, id: section.id } : null,
    cancellationRequested: job.cancellationRequested,
    attempts: attempts.length,
    retryRemaining,
    callBudgetRemaining: Math.max(0, 64 - setupCalls),
    runBudgetRemaining: Math.max(0, run.budget.maxCalls - run.reservedCalls),
    usage,
    failureCode:
      job.state === "failed"
        ? safeFailures.has(job.error.code)
          ? job.error.code
          : "provider-failure"
        : null,
    canRetry:
      job.state === "failed" &&
      job.error.retryable &&
      retryRemaining > 0 &&
      last?.state === "response-received" &&
      !last.retryApproved &&
      run.state === "running" &&
      setupCalls < 64 &&
      run.reservedCalls < run.budget.maxCalls,
    unknownAttemptId: unknown?.id ?? null,
    provider: job.provider,
    model: job.model,
  }
}
