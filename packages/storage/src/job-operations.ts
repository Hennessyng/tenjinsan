import { GenerationRun, type Job as JobRecord } from "@reading-studio/contracts"
import { and, desc, eq, lte, or } from "drizzle-orm"
import { jobBriefCurrent, requireJobBrief } from "./brief-approval.ts"
import { ExecutionTransitionError } from "./errors.ts"
import {
  CancellationInput,
  CheckpointInput,
  ClaimJobInput,
  CompletionInput,
  HeartbeatInput,
  LeaseInput,
} from "./execution-inputs.ts"
import {
  type ExecutionStateStore,
  type LoadedJob,
  transitionAttempt,
  transitionJob,
} from "./execution-state.ts"
import { maintenanceActive } from "./maintenance.ts"
import { parseInput } from "./records.ts"
import { externalAttempts, jobs } from "./schema/index.ts"

function cancelledJob(loaded: LoadedJob): JobRecord {
  return transitionJob({ ...loaded.record, cancellationRequested: true }, { state: "cancelled" })
}

export class JobOperations {
  constructor(private readonly state: ExecutionStateStore) {}

  claimNext(input: unknown): JobRecord | null {
    const parsed = parseInput(ClaimJobInput, input, "job claim")
    if (maintenanceActive(this.state.context.sqlite)) return null
    const eligible = () =>
      this.state.context.db
        .select({ id: jobs.id })
        .from(jobs)
        .where(
          or(
            eq(jobs.state, "queued"),
            and(eq(jobs.state, "running"), lte(jobs.leaseExpiresAt, parsed.now)),
          ),
        )
        .get()
    if (eligible() === undefined) return null
    return this.state.immediate("job claim", parsed.token, () => {
      if (maintenanceActive(this.state.context.sqlite)) return null
      while (true) {
        const row = eligible()
        if (row === undefined) return null
        const loaded = this.state.loadJob(row.id)
        const latestAttemptRow = this.state.context.db
          .select()
          .from(externalAttempts)
          .where(eq(externalAttempts.runId, loaded.record.runId))
          .orderBy(desc(externalAttempts.reservation))
          .get()
        if (latestAttemptRow?.state === "dispatching") {
          const attempt = this.state.loadAttempt(latestAttemptRow.id)
          if (attempt.state !== "dispatching") {
            throw new ExecutionTransitionError("attempt", attempt.id, "dispatching")
          }
          const isCancelled = loaded.record.cancellationRequested
          this.state.writeAttempt(
            transitionAttempt(attempt, {
              state: "outcome_unknown",
              dispatchedAt: attempt.dispatchedAt,
              usage: { kind: "unknown" },
              resolution: isCancelled ? "stop-approved" : "awaiting-owner",
            }),
          )
          const run = this.state.loadRun(loaded.record.runId)
          this.state.writeRun(
            parseInput(
              GenerationRun,
              { ...run, state: isCancelled ? "cancelled" : "paused" },
              "run recovery",
            ),
          )
          this.state.writeJob(
            transitionJob(
              { ...loaded.record, usage: { kind: "unknown" } },
              isCancelled ? { state: "cancelled" } : { state: "paused", reason: "outcome_unknown" },
            ),
            loaded.fence,
          )
          continue
        }
        if (
          loaded.record.cancellationRequested ||
          !jobBriefCurrent(this.state.context, loaded.record)
        ) {
          this.cancel(loaded)
          continue
        }
        const fence = loaded.fence + 1
        const claimed = transitionJob(loaded.record, {
          state: "running",
          lease: {
            token: parsed.token,
            fence,
            heartbeatAt: parsed.now,
            expiresAt: parsed.expiresAt,
          },
        })
        this.state.writeJob(claimed, fence)
        return claimed
      }
    })
  }

  releaseForMaintenance(input: unknown): JobRecord {
    const parsed = parseInput(LeaseInput, input, "maintenance release")
    return this.state.immediate("maintenance release", parsed.jobId, () => {
      const claim = this.state.requireClaim(parsed)
      const job = transitionJob(claim.job, { state: "queued" })
      this.state.writeJob(job, claim.fence)
      return job
    })
  }

  heartbeat(input: unknown): JobRecord {
    const parsed = parseInput(HeartbeatInput, input, "job heartbeat")
    return this.state.immediate("job heartbeat", parsed.jobId, () => {
      const claim = this.state.requireClaim(parsed)
      const job = transitionJob(claim.job, {
        state: "running",
        lease: {
          token: claim.job.lease.token,
          fence: claim.job.lease.fence,
          heartbeatAt: parsed.now,
          expiresAt: parsed.expiresAt,
        },
      })
      this.state.writeJob(job, claim.fence)
      return job
    })
  }

  saveCheckpoint(input: unknown): JobRecord {
    const parsed = parseInput(CheckpointInput, input, "job checkpoint")
    return this.state.immediate("job checkpoint", parsed.jobId, () => {
      const claim = this.state.requireClaim(parsed)
      if (claim.job.cancellationRequested) {
        throw new ExecutionTransitionError("job", claim.job.id, "active without cancellation")
      }
      const job = transitionJob(
        { ...claim.job, checkpoint: parsed.checkpoint },
        {
          state: "running",
          lease: claim.job.lease,
        },
      )
      this.state.writeJob(job, claim.fence)
      return job
    })
  }

  complete(input: unknown): JobRecord {
    const parsed = parseInput(CompletionInput, input, "job completion")
    return this.state.immediate("job completion", parsed.jobId, () => {
      const claim = this.state.requireClaim(parsed)
      requireJobBrief(this.state.context, claim.job)
      if (claim.job.cancellationRequested) {
        throw new ExecutionTransitionError("job", claim.job.id, "active without cancellation")
      }
      const job = transitionJob(claim.job, { state: "completed", resultHash: parsed.resultHash })
      this.state.writeJob(job, claim.fence)
      return job
    })
  }

  requestCancellation(input: unknown): JobRecord {
    const parsed = parseInput(CancellationInput, input, "job cancellation")
    return this.state.immediate("job cancellation", parsed.jobId, () => {
      const loaded = this.state.loadJob(parsed.jobId)
      if (
        loaded.record.state === "completed" ||
        loaded.record.state === "failed" ||
        loaded.record.state === "cancelled"
      ) {
        return loaded.record
      }
      if (loaded.record.state === "running") {
        const requested = transitionJob(
          { ...loaded.record, cancellationRequested: true },
          { state: "running", lease: loaded.record.lease },
        )
        this.state.writeJob(requested, loaded.fence)
        return requested
      }
      return this.cancel(loaded)
    })
  }

  cancelClaimed(input: unknown): JobRecord {
    const parsed = parseInput(LeaseInput, input, "claimed job cancellation")
    return this.state.immediate("job cancellation", "claimed", () => {
      const claim = this.state.requireClaim(parsed)
      if (!claim.job.cancellationRequested) {
        throw new ExecutionTransitionError("job", claim.job.id, "cancellation requested")
      }
      return this.cancel({ record: claim.job, fence: claim.fence })
    })
  }

  private cancel(loaded: LoadedJob): JobRecord {
    const job = cancelledJob(loaded)
    const run = this.state.loadRun(job.runId)
    const latestAttemptRow = this.state.context.db
      .select()
      .from(externalAttempts)
      .where(eq(externalAttempts.runId, job.runId))
      .orderBy(desc(externalAttempts.reservation))
      .get()
    if (latestAttemptRow?.state === "dispatching") {
      const attempt = this.state.loadAttempt(latestAttemptRow.id)
      if (attempt.state !== "dispatching") {
        throw new ExecutionTransitionError("attempt", attempt.id, "dispatching")
      }
      this.state.writeAttempt(
        transitionAttempt(attempt, {
          state: "outcome_unknown",
          dispatchedAt: attempt.dispatchedAt,
          usage: { kind: "unknown" },
          resolution: "stop-approved",
        }),
      )
    } else if (latestAttemptRow?.state === "outcome_unknown") {
      const attempt = this.state.loadAttempt(latestAttemptRow.id)
      if (attempt.state === "outcome_unknown" && attempt.resolution === "awaiting-owner") {
        this.state.writeAttempt(
          transitionAttempt(attempt, {
            state: "outcome_unknown",
            dispatchedAt: attempt.dispatchedAt,
            usage: { kind: "unknown" },
            resolution: "stop-approved",
          }),
        )
      }
    }
    this.state.writeRun(parseInput(GenerationRun, { ...run, state: "cancelled" }, "run cancel"))
    this.state.writeJob(job, loaded.fence)
    return job
  }
}
