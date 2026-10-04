import type Database from "better-sqlite3"
import { z } from "zod"
import { PrivateBlobStore } from "./blob-store.ts"
import { BriefRepository } from "./briefs.ts"
import type { StorageContext, StorageDiagnostics } from "./database.ts"
import { databaseDiagnostics, openDatabase } from "./database.ts"
import { ContractBoundaryError, StoredRecordError } from "./errors.ts"
import { type ExecutionRepository, SqliteExecutionRepository } from "./execution.ts"
import { InterviewRepository } from "./interviews.ts"
import { MaintenanceAdmission } from "./maintenance.ts"
import {
  holdMaintenanceProcess,
  registerMaintenanceInstance,
  releaseMaintenanceInstance,
} from "./maintenance-process-lock.ts"
import { OutlineRepository } from "./outlines.ts"
import { ProviderConnections } from "./provider-connections.ts"
import { PublicationOutputs } from "./publication-outputs.ts"
import { parseInput, readProperty } from "./records.ts"
import { ReviewRepository } from "./reviews.ts"
import { RevisionRepository } from "./revisions.ts"
import { type SourceRepository, SqliteSourceRepository } from "./sources.ts"
import { SqliteWorkflowRepository, type WorkflowRepository } from "./workflow.ts"
import { AnalysisRepository } from "./workflow-analysis.ts"
import { PublicationRepository } from "./workflow-publication.ts"
import { StudyWorkflowRepository } from "./workflow-study.ts"

export type StorageCounts = {
  readonly editions: number
  readonly studies: number
  readonly normalizations: number
  readonly sourceBlocks: number
  readonly setups: number
  readonly grants: number
  readonly analyses: number
  readonly questions: number
  readonly answers: number
  readonly briefs: number
  readonly outlines: number
  readonly lessons: number
  readonly evidenceReports: number
  readonly approvals: number
  readonly privacyReviews: number
  readonly publications: number
  readonly runs: number
  readonly attempts: number
  readonly jobs: number
  readonly artifacts: number
}

export interface Storage {
  readonly providerConnections: ProviderConnections
  readonly maintenance: MaintenanceAdmission
  readonly revisions: RevisionRepository
  readonly publicationOutputs: PublicationOutputs
  readonly reviews: ReviewRepository
  readonly outlines: OutlineRepository
  readonly briefs: BriefRepository
  readonly interviews: InterviewRepository
  readonly sources: SourceRepository
  readonly workflow: WorkflowRepository
  readonly execution: ExecutionRepository
  readonly blobs: PrivateBlobStore
  diagnostics(): StorageDiagnostics
  counts(): StorageCounts
  close(): void
}

function countRows(context: StorageContext, table: string): number {
  const row: unknown = context.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()
  const value = readProperty(row, `${table} count`, "count")
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new StoredRecordError(`${table} count`, table)
  }
  return value
}

class SqliteStorage implements Storage {
  readonly providerConnections: ProviderConnections
  readonly maintenance: MaintenanceAdmission
  readonly revisions: RevisionRepository
  readonly publicationOutputs: PublicationOutputs
  readonly reviews: ReviewRepository
  readonly outlines: OutlineRepository
  readonly briefs: BriefRepository
  readonly interviews: InterviewRepository
  readonly sources: SourceRepository
  readonly workflow: WorkflowRepository
  readonly execution: ExecutionRepository

  constructor(
    private readonly context: StorageContext,
    readonly blobs: PrivateBlobStore,
    private readonly processLock: Database.Database,
    private readonly instanceId: string,
    privateDataRoot: string,
  ) {
    this.providerConnections = new ProviderConnections(privateDataRoot)
    this.maintenance = new MaintenanceAdmission(context)
    const sources = new SqliteSourceRepository(context)
    this.reviews = new ReviewRepository(context)
    const analyses = new AnalysisRepository(context, sources)
    this.interviews = new InterviewRepository(context, sources, analyses)
    this.briefs = new BriefRepository(context, sources, this.interviews)
    const study = new StudyWorkflowRepository(context, sources)
    const publications = new PublicationRepository(context, analyses, study)
    this.sources = sources
    this.workflow = new SqliteWorkflowRepository(analyses, study, publications)
    this.outlines = new OutlineRepository(context, { briefs: this.briefs, workflow: this.workflow })
    this.publicationOutputs = new PublicationOutputs(context, publications, this.outlines)
    this.execution = new SqliteExecutionRepository(context, sources, publications)
    this.revisions = new RevisionRepository(context, this)
  }

  diagnostics(): StorageDiagnostics {
    return databaseDiagnostics(this.context.sqlite)
  }

  counts(): StorageCounts {
    return Object.freeze({
      editions: countRows(this.context, "book_editions"),
      studies: countRows(this.context, "studies"),
      normalizations: countRows(this.context, "normalization_revisions"),
      sourceBlocks: countRows(this.context, "source_blocks"),
      setups: countRows(this.context, "setup_revisions"),
      grants: countRows(this.context, "transmission_grants"),
      analyses: countRows(this.context, "analysis_revisions"),
      questions: countRows(this.context, "question_revisions"),
      answers: countRows(this.context, "answer_revisions"),
      briefs: countRows(this.context, "brief_revisions"),
      outlines: countRows(this.context, "outline_revisions"),
      lessons: countRows(this.context, "lesson_revisions"),
      evidenceReports: countRows(this.context, "evidence_reports"),
      approvals:
        countRows(this.context, "brief_approvals") +
        countRows(this.context, "outline_approvals") +
        countRows(this.context, "publication_approvals"),
      privacyReviews: countRows(this.context, "privacy_reviews"),
      publications: countRows(this.context, "publication_revisions"),
      runs: countRows(this.context, "generation_runs"),
      attempts: countRows(this.context, "external_attempts"),
      jobs: countRows(this.context, "jobs"),
      artifacts: countRows(this.context, "artifacts"),
    })
  }

  close(): void {
    this.providerConnections.close()
    try {
      releaseMaintenanceInstance(this.context.sqlite, this.instanceId)
    } finally {
      try {
        this.context.sqlite.close()
      } finally {
        this.processLock.close()
      }
    }
  }
}

export function openStorage(input: unknown): Storage {
  const databasePath = readProperty(input, "storage configuration", "databasePath")
  const privateDataRoot = readProperty(input, "storage configuration", "privateDataRoot")
  if (typeof databasePath !== "string") throw new ContractBoundaryError("database path")
  if (typeof privateDataRoot !== "string") throw new ContractBoundaryError("private data root")
  const blobs = new PrivateBlobStore(privateDataRoot)
  const role = parseInput(
    z.enum(["api", "worker", "storage"]),
    readProperty(input, "storage configuration", "runtimeRole") ?? "storage",
    "storage runtime role",
  )
  const processLock = holdMaintenanceProcess(databasePath)
  let context: StorageContext | undefined
  try {
    context = openDatabase(databasePath)
    const instanceId = registerMaintenanceInstance(context.sqlite, role)
    return new SqliteStorage(context, blobs, processLock, instanceId, privateDataRoot)
  } catch (error) {
    context?.sqlite.close()
    processLock.close()
    throw error
  }
}
