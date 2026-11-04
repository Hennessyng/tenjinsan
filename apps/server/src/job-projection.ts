import {
  BATCHED_VERIFICATION_VERSION,
  COVERAGE_VERIFICATION_VERSION,
  contentDigest,
  InputCoverage,
  type Job,
} from "@reading-studio/contracts"
import { ProviderReceipt } from "@reading-studio/providers"
import type { Storage } from "@reading-studio/storage"
import { z } from "zod"
import { sourceSemanticSupport } from "./job-source-support.ts"

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
  callBudgetLimit: z.number().int().positive().default(64),
  retired: z.boolean().default(false),
  runBudgetRemaining: z.number().int().nonnegative(),
  usage: Usage,
  failureCode: z.string().nullable(),
  canRetry: z.boolean(),
  unknownAttemptId: z.string().nullable(),
  provider: z.string(),
  model: z.string(),
  inputCoverage: z.array(InputCoverage).optional(),
  processingStep: z.enum(["chapter-map", "book-synthesis", "original-verification"]).optional(),
  processingStrategy: z.enum(["complete-maps", "complete-maps-and-original"]).optional(),
  semanticSupport: z.enum(["supported", "attention", "not-established"]).optional(),
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
  "subscription-unverified",
  "subscription-connection-changed",
  "bank-incompatible",
  "question-revision-conflict",
  "route-re-review-required",
  "capacity-unknown",
  "capacity-limit",
  "attempt-budget-limit",
  "analysis-incomplete",
  "unsupported-version",
])

export function projectOwnerJobs(storage: Storage, ownerId: string, setupId?: string) {
  const installationId = storage.sources.getInstallation(ownerId)
  const candidates =
    setupId === undefined
      ? storage.execution.listOwnerJobs(ownerId)
      : storage.execution.listSetupJobs(setupId)
  const owned = candidates.filter((job) => {
    const setup = storage.sources.getSetup(job.setupRevisionId)
    if (job.provider === "openai") return setup !== null && job.grant.ownerId === ownerId
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
  const shared = storage.liveStudyGuard.sharedStatus(job.setupRevisionId)
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
  const lastBody = last && storage.execution.getAttemptReceipt(last.id)
  const lastReceipt = lastBody
    ? ProviderReceipt.safeParse(receiptJson(new TextDecoder().decode(lastBody)))
    : null
  const metadata = lastReceipt?.success ? lastReceipt.data : null
  const coverage = attempts.flatMap((attempt) => {
    const body = storage.execution.getAttemptReceipt(attempt.id)
    if (!body) return []
    let value: unknown
    try {
      value = JSON.parse(new TextDecoder().decode(body))
    } catch (error) {
      if (error instanceof SyntaxError) return []
      throw error
    }
    const receipt = ProviderReceipt.safeParse(value)
    return receipt.success && receipt.data.inputCoverage ? [receipt.data.inputCoverage] : []
  })
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
    ...(metadata?.processingStep
      ? {
          processingStep: metadata.processingStep,
          semanticSupport:
            metadata.kind === "output" && metadata.processingStep === "original-verification"
              ? sourceSemanticSupport({
                  target: metadata.verificationTarget,
                  batchTarget: metadata.batchTarget,
                  output: receiptJson(metadata.text),
                  requiredCoverage:
                    (setup.analysis.processing?.synthesisVersion ===
                      COVERAGE_VERIFICATION_VERSION ||
                      setup.analysis.processing?.synthesisVersion ===
                        BATCHED_VERIFICATION_VERSION) &&
                    job.id.startsWith("wb-"),
                })
              : "not-established",
        }
      : {}),
    ...(metadata?.processingStrategy ? { processingStrategy: metadata.processingStrategy } : {}),
    id: job.id,
    studyId: setup.studyId,
    sourceRevisionId: setup.analysis.normalizationRevisionId,
    setupRevisionId: job.setupRevisionId,
    inputRevisionId: job.inputRevisionId,
    stage: job.stage,
    state: job.provider === "openai" ? "historical-inert" : job.state,
    reason: job.state === "paused" ? job.reason : null,
    trace_id: pause?.trace_id ?? null,
    explanation:
      job.provider === "openai"
        ? "Historical direct-OpenAI work is read-only and cannot be dispatched or retried. Create a new setup and grant for another provider."
        : pause
          ? pause.code === "output-limit"
            ? "Reply exceeded the studio output-token cap. No automatic replay."
            : "Provider access was rejected or its route or usage limit is unavailable. Check your connection before approving new work. No automatic replay or provider switch."
          : null,
    checkpoint: job.checkpoint !== null,
    section: section ? { index: sectionIndex, id: section.id } : null,
    cancellationRequested: job.cancellationRequested,
    attempts: attempts.length,
    retryRemaining,
    callBudgetRemaining: shared ? shared.remaining : Math.max(0, 64 - setupCalls),
    callBudgetLimit: shared?.limit ?? 64,
    retired: shared?.retired ?? false,
    runBudgetRemaining: Math.max(0, run.budget.maxCalls - run.reservedCalls),
    usage,
    failureCode:
      job.state === "failed"
        ? safeFailures.has(job.error.code)
          ? job.error.code
          : "provider-failure"
        : null,
    canRetry:
      job.provider !== "openai" &&
      job.state === "failed" &&
      job.error.retryable &&
      retryRemaining > 0 &&
      last?.state === "response-received" &&
      !last.retryApproved &&
      run.state === "running" &&
      (shared ? shared.remaining > 0 && !shared.retired : setupCalls < 64) &&
      run.reservedCalls < run.budget.maxCalls,
    unknownAttemptId: job.provider === "openai" ? null : (unknown?.id ?? null),
    provider: job.provider,
    model: job.model,
    ...(coverage.length ? { inputCoverage: coverage } : {}),
  }
}
function receiptJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch (error) {
    if (error instanceof SyntaxError) return null
    throw error
  }
}
