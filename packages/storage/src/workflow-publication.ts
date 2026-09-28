import {
  type PrivacyReview as PrivacyRecord,
  PrivacyReview,
  PrivacyReviewId,
  type PublicationRevision as PublicationRecord,
  PublicationRevision,
  PublicationRevisionId,
} from "@reading-studio/contracts"
import { eq } from "drizzle-orm"
import type { StorageContext } from "./database.ts"
import { ContractBoundaryError } from "./errors.ts"
import { decodeRecord, encodeRecord, parseInput, readProperty, writeRecord } from "./records.ts"
import { privacyReviews, publicationApprovals, publicationRevisions } from "./schema/index.ts"
import type { AnalysisRepository } from "./workflow-analysis.ts"
import type { StudyWorkflowRepository } from "./workflow-study.ts"

export class PublicationRepository {
  constructor(
    private readonly context: StorageContext,
    private readonly analyses: AnalysisRepository,
    private readonly workflow: StudyWorkflowRepository,
  ) {}

  appendPrivacyReview(input: unknown): PrivacyRecord {
    const record = parseInput(
      PrivacyReview,
      readProperty(input, "privacy review write", "record"),
      "privacy review",
    )
    const rawParent = readProperty(input, "privacy review write", "parentRevisionId")
    const parentRevisionId =
      rawParent === null ? null : parseInput(PrivacyReviewId, rawParent, "parent privacy review ID")
    return writeRecord("privacy review", record.id, () => {
      this.context.db
        .insert(privacyReviews)
        .values({
          id: record.id,
          projectionHash: record.projectionHash,
          parentRevisionId,
          status: record.status,
          recordJson: encodeRecord(record),
        })
        .run()
      return record
    })
  }

  appendPublication(input: unknown): PublicationRecord {
    const submitted = parseInput(
      PublicationRevision,
      readProperty(input, "publication write", "record"),
      "publication revision",
    )
    const rawParent = readProperty(input, "publication write", "parentRevisionId")
    const parentRevisionId =
      rawParent === null
        ? null
        : parseInput(PublicationRevisionId, rawParent, "parent publication ID")
    const privacyReview = this.getPrivacyReview(submitted.privacyReview.id)
    if (
      privacyReview === null ||
      this.workflow.getLesson(submitted.lessonRevisionId) === null ||
      this.analyses.get(submitted.analysisRevisionId) === null
    ) {
      throw new ContractBoundaryError("publication lineage")
    }
    const record = parseInput(
      PublicationRevision,
      { ...submitted, privacyReview },
      "authoritative publication revision",
    )
    return writeRecord("publication revision", record.id, () => {
      this.context.db.transaction((transaction) => {
        transaction
          .insert(publicationRevisions)
          .values({
            id: record.id,
            lessonRevisionId: record.lessonRevisionId,
            analysisRevisionId: record.analysisRevisionId,
            privacyReviewId: record.privacyReview.id,
            parentRevisionId,
            projectionHash: record.projectionHash,
            recordJson: encodeRecord(record),
          })
          .run()
        transaction
          .insert(publicationApprovals)
          .values({
            publicationRevisionId: record.id,
            privacyReviewId: record.approval.privacyReviewId,
            projectionHash: record.approval.projectionHash,
            approvedAt: record.approval.approvedAt,
            recordJson: encodeRecord(record.approval),
          })
          .run()
      })
      return record
    })
  }

  getPrivacyReview(input: unknown): PrivacyRecord | null {
    const id = parseInput(PrivacyReviewId, input, "privacy review ID")
    const row = this.context.db.select().from(privacyReviews).where(eq(privacyReviews.id, id)).get()
    return row === undefined
      ? null
      : decodeRecord(PrivacyReview, row.recordJson, "privacy review", id)
  }

  getPublication(input: unknown): PublicationRecord | null {
    const id = parseInput(PublicationRevisionId, input, "publication revision ID")
    const row = this.context.db
      .select()
      .from(publicationRevisions)
      .where(eq(publicationRevisions.id, id))
      .get()
    return row === undefined
      ? null
      : decodeRecord(PublicationRevision, row.recordJson, "publication revision", id)
  }
}
