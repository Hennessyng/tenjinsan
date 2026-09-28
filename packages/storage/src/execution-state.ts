import type {
  ExternalAttempt as AttemptRecord,
  Job as JobRecord,
  GenerationRun as RunRecord,
} from "@reading-studio/contracts"
import { ExternalAttempt, GenerationRun, Job } from "@reading-studio/contracts"
import { eq } from "drizzle-orm"
import type { StorageContext } from "./database.ts"
import { ExecutionTransitionError, LeaseFenceError } from "./errors.ts"
import type { LeaseReference } from "./execution-inputs.ts"
import { decodeRecord, encodeRecord, parseInput, writeRecord } from "./records.ts"
import { externalAttempts, generationRuns, jobs } from "./schema/index.ts"

export type RunningJob = Extract<JobRecord, { readonly state: "running" }>
type AttemptUsage = Extract<AttemptRecord, { readonly state: "response-received" }>["usage"]

export type LoadedJob = {
  readonly record: JobRecord
  readonly fence: number
}

type JobVariant =
  | { readonly state: "queued" }
  | { readonly state: "running"; readonly lease: RunningJob["lease"] }
  | {
      readonly state: "paused"
      readonly reason: "outcome_unknown" | "budget-exhausted" | "owner" | "restored"
    }
  | {
      readonly state: "failed"
      readonly error: { readonly code: string; readonly retryable: boolean }
    }
  | { readonly state: "completed"; readonly resultHash: string }
  | { readonly state: "cancelled" }

export function transitionJob(record: JobRecord, variant: JobVariant): JobRecord {
  const base = {
    id: record.id,
    runId: record.runId,
    inputRevisionId: record.inputRevisionId,
    setupRevisionId: record.setupRevisionId,
    provider: record.provider,
    model: record.model,
    promptVersion: record.promptVersion,
    schemaVersion: record.schemaVersion,
    grant: record.grant,
    stage: record.stage,
    checkpoint: record.checkpoint,
    cancellationRequested: record.cancellationRequested,
    usage: record.usage,
  }
  return parseInput(Job, { ...base, ...variant }, "job transition")
}

export function transitionAttempt(
  record: AttemptRecord,
  variant:
    | { readonly state: "prepared" }
    | { readonly state: "dispatching"; readonly dispatchedAt: string }
    | {
        readonly state: "response-received"
        readonly retryApproved?: true
        readonly dispatchedAt: string
        readonly receivedAt: string
        readonly responseHash: string
        readonly usage: AttemptUsage
      }
    | {
        readonly state: "outcome_unknown"
        readonly dispatchedAt: string
        readonly usage: { readonly kind: "unknown" }
        readonly resolution: "awaiting-owner" | "retry-approved" | "stop-approved"
      },
): AttemptRecord {
  return parseInput(
    ExternalAttempt,
    {
      id: record.id,
      runId: record.runId,
      reservation: record.reservation,
      inputRevisionId: record.inputRevisionId,
      preparedAt: record.preparedAt,
      ...variant,
    },
    "attempt transition",
  )
}

export class ExecutionStateStore {
  constructor(readonly context: StorageContext) {}

  immediate<T>(entity: string, id: string, operation: () => T): T {
    return writeRecord(entity, id, () => this.context.sqlite.transaction(operation).immediate())
  }

  loadJob(id: string): LoadedJob {
    const row = this.context.db.select().from(jobs).where(eq(jobs.id, id)).get()
    if (row === undefined) throw new ExecutionTransitionError("job", id, "persisted")
    return {
      record: decodeRecord(Job, row.recordJson, "job", id),
      fence: row.leaseFence,
    }
  }

  loadRun(id: string): RunRecord {
    const row = this.context.db.select().from(generationRuns).where(eq(generationRuns.id, id)).get()
    if (row === undefined) throw new ExecutionTransitionError("run", id, "persisted")
    return decodeRecord(GenerationRun, row.recordJson, "generation run", id)
  }

  loadAttempt(id: string): AttemptRecord {
    const row = this.context.db
      .select()
      .from(externalAttempts)
      .where(eq(externalAttempts.id, id))
      .get()
    if (row === undefined) throw new ExecutionTransitionError("attempt", id, "persisted")
    return decodeRecord(ExternalAttempt, row.recordJson, "external attempt", id)
  }

  requireClaim(parsed: LeaseReference): { readonly job: RunningJob; readonly fence: number } {
    const loaded = this.loadJob(parsed.jobId)
    if (
      loaded.record.state !== "running" ||
      loaded.record.lease.token !== parsed.token ||
      loaded.record.lease.fence !== parsed.fence ||
      loaded.fence !== parsed.fence ||
      Date.parse(loaded.record.lease.expiresAt) <= Date.parse(parsed.now)
    ) {
      throw new LeaseFenceError(parsed.jobId)
    }
    return { job: loaded.record, fence: loaded.fence }
  }

  writeJob(record: JobRecord, fence: number): void {
    this.context.db
      .update(jobs)
      .set({
        state: record.state,
        checkpoint: record.checkpoint,
        cancellationRequested: record.cancellationRequested,
        leaseFence: fence,
        leaseToken: record.state === "running" ? record.lease.token : null,
        leaseExpiresAt: record.state === "running" ? record.lease.expiresAt : null,
        recordJson: encodeRecord(record),
      })
      .where(eq(jobs.id, record.id))
      .run()
  }

  writeRun(record: RunRecord): void {
    this.context.db
      .update(generationRuns)
      .set({
        state: record.state,
        reservedCalls: record.reservedCalls,
        recordJson: encodeRecord(record),
      })
      .where(eq(generationRuns.id, record.id))
      .run()
  }

  writeAttempt(record: AttemptRecord, responseBody?: Uint8Array): void {
    this.context.db
      .update(externalAttempts)
      .set({
        state: record.state,
        recordJson: encodeRecord(record),
        ...(responseBody === undefined ? {} : { responseBody: Buffer.from(responseBody) }),
      })
      .where(eq(externalAttempts.id, record.id))
      .run()
  }
}
