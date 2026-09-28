import { GenerationRun, JobId } from "@reading-studio/contracts"
import { z } from "zod"
import type { AttemptOperations } from "./attempt-operations.ts"
import { ExecutionTransitionError } from "./errors.ts"
import { LeaseInput } from "./execution-inputs.ts"
import { type ExecutionStateStore, transitionAttempt, transitionJob } from "./execution-state.ts"

const Failure = z.strictObject({
  lease: LeaseInput,
  code: z.string().min(1),
  retryable: z.boolean(),
})
export class ProviderOperations {
  constructor(
    private readonly state: ExecutionStateStore,
    private readonly attempts: AttemptOperations,
  ) {}
  fail(input: unknown) {
    const parsed = Failure.parse(input)
    return this.state.immediate("provider failure", parsed.lease.jobId, () => {
      const claim = this.state.requireClaim(parsed.lease)
      const job = transitionJob(claim.job, {
        state: "failed",
        error: { code: parsed.code, retryable: parsed.retryable },
      })
      this.state.writeJob(job, claim.fence)
      return job
    })
  }
  pauseUnknown(input: unknown) {
    const lease = LeaseInput.parse(input)
    return this.state.immediate("provider unknown", lease.jobId, () => {
      const claim = this.state.requireClaim(lease)
      const attempt = this.attempts.list(claim.job.runId).at(-1)
      if (attempt?.state !== "dispatching")
        throw new ExecutionTransitionError("attempt", claim.job.id, "dispatching")
      this.state.writeAttempt(
        transitionAttempt(attempt, {
          state: "outcome_unknown",
          dispatchedAt: attempt.dispatchedAt,
          usage: { kind: "unknown" },
          resolution: "awaiting-owner",
        }),
      )
      const run = this.state.loadRun(claim.job.runId)
      this.state.writeRun(GenerationRun.parse({ ...run, state: "paused" }))
      const job = transitionJob(
        { ...claim.job, usage: { kind: "unknown" } },
        { state: "paused", reason: "outcome_unknown" },
      )
      this.state.writeJob(job, claim.fence)
      return job
    })
  }
  retry(input: unknown) {
    const id = JobId.parse(input)
    return this.state.immediate("provider retry", id, () => {
      const loaded = this.state.loadJob(id)
      const run = this.state.loadRun(loaded.record.runId)
      const attempts = this.attempts.list(run.id)
      const latest = attempts.at(-1)
      if (
        loaded.record.state !== "failed" ||
        !loaded.record.error.retryable ||
        loaded.record.cancellationRequested ||
        run.state !== "running" ||
        latest?.state !== "response-received" ||
        latest.retryApproved ||
        attempts.filter((attempt) => attempt.state === "response-received" && attempt.retryApproved)
          .length >= run.budget.maxTransientRetries
      )
        throw new ExecutionTransitionError("job", id, "explicit bounded provider retry")
      this.state.writeAttempt(transitionAttempt(latest, { ...latest, retryApproved: true }))
      const job = transitionJob(loaded.record, { state: "queued" })
      this.state.writeJob(job, loaded.fence)
      return job
    })
  }
}
