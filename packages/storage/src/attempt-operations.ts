import { createHash } from "node:crypto"
import {
  AttemptId,
  type ExternalAttempt as AttemptRecord,
  Digest,
  ExternalAttempt,
  GenerationRun,
  RunId,
} from "@reading-studio/contracts"
import { asc, eq } from "drizzle-orm"
import { z } from "zod"
import { requireJobBrief } from "./brief-approval.ts"
import { ExecutionTransitionError, MaintenancePausedError, StoredRecordError } from "./errors.ts"
import {
  DispatchAttemptInput,
  PrepareAttemptInput,
  ReceiptAttemptInput,
  type ReserveAttemptResult,
  ResolveAttemptInput,
} from "./execution-inputs.ts"
import { type ExecutionStateStore, transitionAttempt, transitionJob } from "./execution-state.ts"
import { maintenanceActive } from "./maintenance.ts"
import { decodeRecord, encodeRecord, parseInput } from "./records.ts"
import { externalAttempts, jobs } from "./schema/index.ts"

export class AttemptOperations {
  constructor(private readonly state: ExecutionStateStore) {}

  reserve(input: unknown): ReserveAttemptResult {
    const parsed = parseInput(PrepareAttemptInput, input, "attempt preparation")
    return this.state.immediate("attempt preparation", parsed.attemptId, () => {
      const claim = this.state.requireClaim(parsed)
      requireJobBrief(this.state.context, claim.job)
      if (claim.job.cancellationRequested) {
        throw new ExecutionTransitionError("job", claim.job.id, "active without cancellation")
      }
      const run = this.state.loadRun(claim.job.runId)
      if (run.state !== "running") {
        throw new ExecutionTransitionError("run", run.id, "running")
      }
      const aggregate = this.state.context.sqlite
        .prepare(`SELECT COUNT(DISTINCT a.id) AS calls FROM external_attempts a
          JOIN jobs j ON j.run_id = a.run_id WHERE j.setup_revision_id = ?`)
        .get(claim.job.setupRevisionId)
      const total = z.object({ calls: z.number().int().nonnegative() }).parse(aggregate).calls
      if (run.reservedCalls >= run.budget.maxCalls || total >= 64) {
        this.state.writeRun(parseInput(GenerationRun, { ...run, state: "paused" }, "run pause"))
        this.state.writeJob(
          transitionJob(claim.job, { state: "paused", reason: "budget-exhausted" }),
          claim.fence,
        )
        return { kind: "budget-exhausted" }
      }
      const reservation = run.reservedCalls + 1
      const attempt = parseInput(
        ExternalAttempt,
        {
          id: parsed.attemptId,
          runId: run.id,
          reservation,
          inputRevisionId: run.inputRevisionId,
          preparedAt: parsed.preparedAt,
          state: "prepared",
        },
        "prepared attempt",
      )
      const updatedRun = parseInput(
        GenerationRun,
        { ...run, reservedCalls: reservation },
        "run reservation",
      )
      this.state.writeRun(updatedRun)
      this.state.context.db
        .insert(externalAttempts)
        .values({
          id: attempt.id,
          runId: attempt.runId,
          inputRevisionId: attempt.inputRevisionId,
          state: attempt.state,
          reservation: attempt.reservation,
          responseBody: null,
          recordJson: encodeRecord(attempt),
        })
        .run()
      return { kind: "prepared", attempt }
    })
  }

  markDispatching(input: unknown): AttemptRecord {
    const parsed = parseInput(DispatchAttemptInput, input, "attempt dispatch")
    return this.state.immediate("attempt dispatch", parsed.attemptId, () => {
      if (maintenanceActive(this.state.context.sqlite)) throw new MaintenancePausedError()
      const claim = this.state.requireClaim(parsed)
      requireJobBrief(this.state.context, claim.job)
      if (claim.job.cancellationRequested) {
        throw new ExecutionTransitionError("job", claim.job.id, "active without cancellation")
      }
      const attempt = this.state.loadAttempt(parsed.attemptId)
      if (attempt.state !== "prepared" || attempt.runId !== claim.job.runId) {
        throw new ExecutionTransitionError("attempt", attempt.id, "prepared for claimed run")
      }
      const dispatched = transitionAttempt(attempt, {
        state: "dispatching",
        dispatchedAt: parsed.dispatchedAt,
      })
      this.state.writeAttempt(dispatched)
      return dispatched
    })
  }

  recordReceipt(input: unknown): AttemptRecord {
    const parsed = parseInput(ReceiptAttemptInput, input, "attempt receipt")
    return this.state.immediate("attempt receipt", parsed.attemptId, () => {
      const claim = this.state.requireClaim(parsed)
      const attempt = this.state.loadAttempt(parsed.attemptId)
      if (attempt.state !== "dispatching" || attempt.runId !== claim.job.runId) {
        throw new ExecutionTransitionError("attempt", attempt.id, "dispatching for claimed run")
      }
      const responseHash = parseInput(
        Digest,
        createHash("sha256").update(parsed.responseBody).digest("hex"),
        "response hash",
      )
      const received = transitionAttempt(attempt, {
        state: "response-received",
        dispatchedAt: attempt.dispatchedAt,
        receivedAt: parsed.receivedAt,
        responseHash,
        usage: parsed.usage,
      })
      this.state.writeAttempt(received, parsed.responseBody)
      const usages = this.list(claim.job.runId).flatMap((attempt) =>
        "usage" in attempt ? [attempt.usage] : [],
      )
      const usage = usages.some((usage) => usage.kind === "unknown")
        ? { kind: "unknown" as const }
        : usages
            .filter((usage) => usage.kind === "known")
            .reduce(
              (total, usage) => ({
                kind: "known" as const,
                inputTokens: total.inputTokens + usage.inputTokens,
                outputTokens: total.outputTokens + usage.outputTokens,
              }),
              { kind: "known" as const, inputTokens: 0, outputTokens: 0 },
            )
      this.state.writeJob(
        transitionJob({ ...claim.job, usage }, { state: "running", lease: claim.job.lease }),
        claim.fence,
      )
      return received
    })
  }

  resolveUnknown(input: unknown): AttemptRecord {
    const parsed = parseInput(ResolveAttemptInput, input, "unknown attempt resolution")
    return this.state.immediate("unknown attempt resolution", parsed.attemptId, () => {
      const attempt = this.state.loadAttempt(parsed.attemptId)
      if (attempt.state === "outcome_unknown" && attempt.resolution === parsed.resolution) {
        return attempt
      }
      if (attempt.state !== "outcome_unknown" || attempt.resolution !== "awaiting-owner") {
        throw new ExecutionTransitionError("attempt", attempt.id, "awaiting owner")
      }
      const jobRow = this.state.context.db
        .select()
        .from(jobs)
        .where(eq(jobs.runId, attempt.runId))
        .get()
      if (jobRow === undefined)
        throw new ExecutionTransitionError("job", attempt.runId, "persisted")
      const loaded = this.state.loadJob(jobRow.id)
      const run = this.state.loadRun(attempt.runId)
      if (
        loaded.record.state === "cancelled" ||
        loaded.record.cancellationRequested ||
        run.state === "cancelled"
      ) {
        throw new ExecutionTransitionError("attempt", attempt.id, "active noncancelled run")
      }
      const resolved = transitionAttempt(attempt, {
        state: "outcome_unknown",
        dispatchedAt: attempt.dispatchedAt,
        usage: { kind: "unknown" },
        resolution: parsed.resolution,
      })
      this.state.writeAttempt(resolved)
      if (parsed.resolution === "retry-approved") {
        this.state.writeRun(parseInput(GenerationRun, { ...run, state: "running" }, "run retry"))
        this.state.writeJob(
          transitionJob({ ...loaded.record, cancellationRequested: false }, { state: "queued" }),
          loaded.fence,
        )
      } else {
        this.state.writeRun(parseInput(GenerationRun, { ...run, state: "cancelled" }, "run stop"))
        this.state.writeJob(
          transitionJob({ ...loaded.record, cancellationRequested: true }, { state: "cancelled" }),
          loaded.fence,
        )
      }
      return resolved
    })
  }

  list(input: unknown): readonly AttemptRecord[] {
    const runId = parseInput(RunId, input, "run ID")
    return this.state.context.db
      .select()
      .from(externalAttempts)
      .where(eq(externalAttempts.runId, runId))
      .orderBy(asc(externalAttempts.reservation))
      .all()
      .map((row) => decodeRecord(ExternalAttempt, row.recordJson, "external attempt", row.id))
  }

  receipt(input: unknown): Uint8Array | null {
    const attemptId = parseInput(AttemptId, input, "attempt ID")
    const attempt = this.state.loadAttempt(attemptId)
    if (attempt.state !== "response-received") return null
    const row = this.state.context.db
      .select()
      .from(externalAttempts)
      .where(eq(externalAttempts.id, attempt.id))
      .get()
    if (row?.responseBody === null || row?.responseBody === undefined) {
      throw new StoredRecordError("attempt receipt", attempt.id)
    }
    const hash = createHash("sha256").update(row.responseBody).digest("hex")
    if (hash !== attempt.responseHash) throw new StoredRecordError("attempt receipt", attempt.id)
    return new Uint8Array(row.responseBody)
  }
}
