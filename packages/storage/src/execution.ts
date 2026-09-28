import {
  Artifact,
  ArtifactId,
  type Artifact as ArtifactRecord,
  AttemptId,
  type ExternalAttempt as AttemptRecord,
  ExternalAttempt,
  GenerationRun,
  Job,
  JobId,
  type Job as JobRecord,
  RunId,
  type GenerationRun as RunRecord,
} from "@reading-studio/contracts"
import { eq } from "drizzle-orm"
import { ArtifactOperations } from "./artifact-operations.ts"
import { AttemptOperations } from "./attempt-operations.ts"
import { appendAuthorizedJob } from "./authorized-job-write.ts"
import type { StorageContext } from "./database.ts"
import type { ReserveAttemptResult } from "./execution-inputs.ts"
import { ExecutionStateStore } from "./execution-state.ts"
import { JobOperations } from "./job-operations.ts"
import { OwnerJobOperations } from "./owner-job-operations.ts"
import { ProviderOperations } from "./provider-operations.ts"
import { decodeRecord, encodeRecord, parseInput, writeRecord } from "./records.ts"
import { artifacts, externalAttempts, generationRuns, jobs } from "./schema/index.ts"
import type { SourceRepository } from "./sources.ts"
import type { PublicationRepository } from "./workflow-publication.ts"

export interface ExecutionRepository {
  appendRun(input: unknown): RunRecord
  appendAttempt(input: unknown): AttemptRecord
  appendJob(input: unknown): JobRecord
  appendArtifact(input: unknown): ArtifactRecord
  getRun(input: unknown): RunRecord | null
  getAttempt(input: unknown): AttemptRecord | null
  getJob(input: unknown): JobRecord | null
  listOwnerJobs(input: unknown): readonly JobRecord[]
  decideOwnerJob(input: unknown): JobRecord
  listCompletedAnalysisJobs(): readonly JobRecord[]
  listCompletedLessonJobs(): readonly JobRecord[]
  getArtifact(input: unknown): ArtifactRecord | null
  claimNextJob(input: unknown): JobRecord | null
  releaseForMaintenance(input: unknown): JobRecord
  heartbeatJob(input: unknown): JobRecord
  saveCheckpoint(input: unknown): JobRecord
  completeJob(input: unknown): JobRecord
  requestCancellation(input: unknown): JobRecord
  cancelClaimedJob(input: unknown): JobRecord
  commitArtifact(input: unknown): ArtifactRecord
  reserveAttempt(input: unknown): ReserveAttemptResult
  markAttemptDispatching(input: unknown): AttemptRecord
  recordAttemptReceipt(input: unknown): AttemptRecord
  resolveUnknownAttempt(input: unknown): AttemptRecord
  listAttempts(input: unknown): readonly AttemptRecord[]
  getAttemptReceipt(input: unknown): Uint8Array | null
  failProviderJob(input: unknown): JobRecord
  pauseUnknownProviderJob(input: unknown): JobRecord
  retryProviderJob(input: unknown): JobRecord
}

export class SqliteExecutionRepository implements ExecutionRepository {
  private readonly jobOperations: JobOperations
  private readonly attemptOperations: AttemptOperations
  private readonly artifactOperations: ArtifactOperations
  private readonly providerOperations: ProviderOperations
  private readonly ownerJobs: OwnerJobOperations

  constructor(
    private readonly context: StorageContext,
    private readonly sources: SourceRepository,
    publications: PublicationRepository,
  ) {
    const state = new ExecutionStateStore(context)
    this.jobOperations = new JobOperations(state)
    this.attemptOperations = new AttemptOperations(state)
    this.providerOperations = new ProviderOperations(state, this.attemptOperations)
    this.artifactOperations = new ArtifactOperations(state, publications)
    this.ownerJobs = new OwnerJobOperations(context, sources, this)
  }

  appendRun(input: unknown): RunRecord {
    const record = parseInput(GenerationRun, input, "generation run")
    return writeRecord("generation run", record.id, () => {
      this.context.db
        .insert(generationRuns)
        .values({
          id: record.id,
          inputRevisionId: record.inputRevisionId,
          state: record.state,
          reservedCalls: record.reservedCalls,
          recordJson: encodeRecord(record),
        })
        .run()
      return record
    })
  }

  appendAttempt(input: unknown): AttemptRecord {
    const record = parseInput(ExternalAttempt, input, "external attempt")
    return writeRecord("external attempt", record.id, () => {
      this.context.db
        .insert(externalAttempts)
        .values({
          id: record.id,
          runId: record.runId,
          inputRevisionId: record.inputRevisionId,
          state: record.state,
          reservation: record.reservation,
          responseBody: null,
          recordJson: encodeRecord(record),
        })
        .run()
      return record
    })
  }

  appendJob(input: unknown): JobRecord {
    return appendAuthorizedJob(this.context, this.sources, input)
  }

  appendArtifact(input: unknown): ArtifactRecord {
    return this.artifactOperations.commit(input)
  }

  getRun(input: unknown): RunRecord | null {
    const id = parseInput(RunId, input, "run ID")
    const row = this.context.db.select().from(generationRuns).where(eq(generationRuns.id, id)).get()
    return row === undefined
      ? null
      : decodeRecord(GenerationRun, row.recordJson, "generation run", id)
  }

  getAttempt(input: unknown): AttemptRecord | null {
    const id = parseInput(AttemptId, input, "attempt ID")
    const row = this.context.db
      .select()
      .from(externalAttempts)
      .where(eq(externalAttempts.id, id))
      .get()
    return row === undefined
      ? null
      : decodeRecord(ExternalAttempt, row.recordJson, "external attempt", id)
  }

  getJob(input: unknown): JobRecord | null {
    const id = parseInput(JobId, input, "job ID")
    const row = this.context.db.select().from(jobs).where(eq(jobs.id, id)).get()
    return row === undefined ? null : decodeRecord(Job, row.recordJson, "job", id)
  }

  listOwnerJobs(input: unknown): readonly JobRecord[] {
    return this.ownerJobs.list(input)
  }

  decideOwnerJob(input: unknown): JobRecord {
    return this.ownerJobs.decide(input)
  }

  listCompletedAnalysisJobs(): readonly JobRecord[] {
    return this.context.db
      .select()
      .from(jobs)
      .where(eq(jobs.state, "completed"))
      .all()
      .map((row) => decodeRecord(Job, row.recordJson, "job", row.id))
      .filter((job) => job.stage === "analysis")
  }

  listCompletedLessonJobs(): readonly JobRecord[] {
    return this.context.db
      .select()
      .from(jobs)
      .where(eq(jobs.state, "completed"))
      .all()
      .map((row) => decodeRecord(Job, row.recordJson, "job", row.id))
      .filter((job) => job.stage === "lesson")
  }

  getArtifact(input: unknown): ArtifactRecord | null {
    const id = parseInput(ArtifactId, input, "artifact ID")
    const row = this.context.db.select().from(artifacts).where(eq(artifacts.id, id)).get()
    return row === undefined ? null : decodeRecord(Artifact, row.recordJson, "artifact", id)
  }

  claimNextJob(input: unknown): JobRecord | null {
    return this.jobOperations.claimNext(input)
  }

  releaseForMaintenance(input: unknown): JobRecord {
    return this.jobOperations.releaseForMaintenance(input)
  }

  heartbeatJob(input: unknown): JobRecord {
    return this.jobOperations.heartbeat(input)
  }

  saveCheckpoint(input: unknown): JobRecord {
    return this.jobOperations.saveCheckpoint(input)
  }

  completeJob(input: unknown): JobRecord {
    return this.jobOperations.complete(input)
  }

  requestCancellation(input: unknown): JobRecord {
    return this.jobOperations.requestCancellation(input)
  }

  cancelClaimedJob(input: unknown): JobRecord {
    return this.jobOperations.cancelClaimed(input)
  }

  commitArtifact(input: unknown): ArtifactRecord {
    return this.artifactOperations.commit(input)
  }

  reserveAttempt(input: unknown): ReserveAttemptResult {
    return this.attemptOperations.reserve(input)
  }

  markAttemptDispatching(input: unknown): AttemptRecord {
    return this.attemptOperations.markDispatching(input)
  }

  recordAttemptReceipt(input: unknown): AttemptRecord {
    return this.attemptOperations.recordReceipt(input)
  }

  resolveUnknownAttempt(input: unknown): AttemptRecord {
    return this.attemptOperations.resolveUnknown(input)
  }

  listAttempts(input: unknown): readonly AttemptRecord[] {
    return this.attemptOperations.list(input)
  }

  getAttemptReceipt(input: unknown): Uint8Array | null {
    return this.attemptOperations.receipt(input)
  }

  failProviderJob(input: unknown): JobRecord {
    return this.providerOperations.fail(input)
  }
  pauseUnknownProviderJob(input: unknown): JobRecord {
    return this.providerOperations.pauseUnknown(input)
  }
  retryProviderJob(input: unknown): JobRecord {
    return this.providerOperations.retry(input)
  }
}
