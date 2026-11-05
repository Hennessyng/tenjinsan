import type { BatchedVerificationReserve } from "@reading-studio/contracts"
import { ProviderError } from "@reading-studio/providers"
import type { WholeBookContext } from "./whole-book-context.ts"

export function batchedRuntimeAllowance(
  context: WholeBookContext,
  reserve: BatchedVerificationReserve,
) {
  const execution = context.authority.storage.execution
  const all = execution.listSetupJobs(context.setup.id)
  const used = new Set(
    all.flatMap((job) => execution.listAttempts(job.runId).map((attempt) => attempt.id)),
  ).size
  const jobs = all.filter((job) => job.stage === "analysis" && job.grant.id === context.grantId)
  if (jobs.length > reserve.maxAnalysisJobs || used < reserve.used)
    throw new ProviderError("attempt-budget-limit")
  const cap = Math.min(
    64,
    reserve.cap,
    context.authority.storage.liveStudyGuard.limit(context.setup.id),
  )
  let remainingAnalysis = (reserve.maxAnalysisJobs - jobs.length) * 2
  for (const job of jobs) {
    const attempts = execution.listAttempts(job.runId).length
    if (attempts > 2) throw new ProviderError("attempt-budget-limit")
    switch (job.state) {
      case "completed":
      case "cancelled":
        break
      case "queued":
      case "running":
      case "paused":
      case "failed":
        remainingAnalysis += 2 - attempts
        break
      default: {
        const impossible: never = job
        throw new TypeError(String(impossible))
      }
    }
  }
  return {
    cap,
    used,
    remaining: Math.max(0, cap - used),
    plannedAttempts: remainingAnalysis + reserve.reservedLaterAttempts,
    reservedLaterAttempts: reserve.reservedLaterAttempts,
    uncertainCounts: true as const,
  }
}
