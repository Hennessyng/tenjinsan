import { fullBookNativeReleased, fullBookNativeScope, type Storage } from "@reading-studio/storage"

export type FullBookRunScope = Readonly<{ id: string; owner: string; setupId: string }>
export function fullBookRunState(
  storage: Storage,
  scope: FullBookRunScope,
  options: Readonly<{ active?: boolean; executable?: boolean; authority?: boolean }> = {},
) {
  const record = storage.fullBookManagedConsents.inspect(scope),
    { budget, grant } = record
  const attempts = storage.fullBookExecution.attempts(budget.id),
    receipts = storage.fullBookExecution.receipts(budget.id)
  const unknown = attempts.filter(
    (attempt) => attempt.state === "outcome_unknown" && attempt.resolution === "awaiting-owner",
  )
  const received = record.jobs.some(
    (job) =>
      job.state !== "completed" &&
      job.repair === 0 &&
      attempts.some(
        (attempt) => attempt.runId === job.run_id && attempt.state === "response-received",
      ),
  )
  const complete = receipts.length === budget.session.plan.nodes.length
  const state = complete
    ? "complete"
    : record.revoked || record.closed
      ? "cancelled"
      : unknown.length && record.recovery?.state !== "pending"
        ? "unknown"
        : record.jobs.some((job) => job.state === "failed")
          ? "failed"
          : received
            ? "received"
            : options.active || record.jobs.some((job) => job.state === "running")
              ? "running"
              : "paused"
  return {
    id: grant.id,
    setupId: budget.setupRevisionId,
    state,
    purpose: "experimental-analysis-only",
    terminal: complete ? "analysis-only" : null,
    retryableUnknownAttempts: unknown
      .filter((attempt) => attempt.reservation < 2)
      .map((attempt) => attempt.id),
    plannedMaxAttempts: budget.session.plan.maxAttempts,
    plannedMaxJobs: budget.session.plan.nodes.length,
    usedAttempts: attempts.length,
    completedNodes: record.jobs.filter((job) => job.state === "completed").length,
    notNeededNodes: record.notNeededNodes,
    unknownAttempts: unknown.map((attempt) => attempt.id),
    usage: attempts.map((attempt) => ({
      id: attempt.id,
      state: attempt.state,
      usage: "usage" in attempt ? attempt.usage : { kind: "unknown" },
    })),
    revoked: record.revoked,
    reviewRequired: options.authority === false && !record.closed && !record.revoked,
    canResume:
      options.authority !== false &&
      Boolean(grant.reviewAcknowledgement) &&
      !record.closed &&
      !record.revoked &&
      record.recovery?.state !== "consumed" &&
      (state === "paused" || state === "received") &&
      (received || options.executable === true),
    canExport:
      record.closed &&
      !record.recovery &&
      unknown.length === 0 &&
      !record.jobs.some((job) => job.state === "running") &&
      !attempts.some((attempt) => attempt.state === "prepared" || attempt.state === "dispatching"),
    native: {
      enabled:
        record.recovery?.state !== "consumed" &&
        fullBookNativeReleased(grant.policy.build, fullBookNativeScope(record)),
      reason: "release-and-runtime-binding-required",
    },
    runtime: {
      kind: grant.policy.build.kind,
      sha256: grant.policy.build.sha256,
      version:
        grant.policy.build.kind === "pinned-codex" ? grant.policy.build.version : "fixture-1",
    },
    sourceCeiling: record.recovery?.effectiveCeiling ?? budget.sourceCeiling,
    ...(record.recovery
      ? {
          originalSourceCeiling: budget.sourceCeiling,
          recovery: {
            id: record.recovery.amendment.id,
            state: record.recovery.state,
            extraHold: 1,
            ordinal: 3,
            stopAfterResult: true,
          },
        }
      : {}),
    sourceBudget: storage.fullBookConsent.preview(
      scope.owner,
      budget.session.input.normalization.editionHash,
    ),
    consentReview: grant.reviewAcknowledgement ?? null,
    recipient: budget.session.destination,
    model: budget.session.model,
    source: {
      hash: budget.session.input.normalization.editionHash,
      coverage: budget.acknowledgement.coverage,
      omissions: budget.acknowledgement.omissions,
    },
    approvedAt: grant.approvedAt,
    downstreamRevisions: false,
    readerContextChanged: false,
  }
}
