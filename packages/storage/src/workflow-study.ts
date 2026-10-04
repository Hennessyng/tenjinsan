import {
  type ReadingBrief as BriefRecord,
  BriefRevisionId,
  EvidenceReport,
  type LessonRevision as LessonRecord,
  LessonRevision,
  LessonRevisionId,
  LocatedSourceSpan,
  type StudyOutline as OutlineRecord,
  OutlineRevisionId,
  ReadingBrief,
  StudyOutline,
  WorkflowLineage,
} from "@reading-studio/contracts"
import { eq } from "drizzle-orm"
import { requireBriefApproval } from "./brief-approval.ts"
import type { StorageContext } from "./database.ts"
import { ContractBoundaryError } from "./errors.ts"
import { decodeRecord, encodeRecord, parseInput, readProperty, writeRecord } from "./records.ts"
import {
  briefApprovals,
  briefRevisions,
  evidenceReports,
  lessonRevisions,
  outlineApprovals,
  outlineRevisions,
} from "./schema/index.ts"
import type { SourceRepository } from "./sources.ts"

type EvidenceRecord = ReturnType<typeof EvidenceReport.parse>

export class StudyWorkflowRepository {
  constructor(
    private readonly context: StorageContext,
    private readonly sources: SourceRepository,
  ) {}

  appendBrief(input: unknown): BriefRecord {
    const record = parseInput(
      ReadingBrief,
      readProperty(input, "brief write", "record"),
      "reading brief",
    )
    const rawParent = readProperty(input, "brief write", "parentRevisionId")
    const parentRevisionId =
      rawParent === null ? null : parseInput(BriefRevisionId, rawParent, "parent brief ID")
    return writeRecord("brief revision", record.id, () => {
      this.context.db.transaction((transaction) => {
        transaction
          .insert(briefRevisions)
          .values({
            id: record.id,
            studyId: record.studyId,
            setupRevisionId: record.setupRevisionId,
            analysisRevisionId: record.analysisRevisionId,
            parentRevisionId,
            recordJson: encodeRecord(record),
          })
          .run()
        transaction
          .insert(briefApprovals)
          .values({
            briefRevisionId: record.id,
            approvedAt: record.approval.approvedAt,
            recordJson: encodeRecord(record.approval),
          })
          .run()
      })
      return record
    })
  }

  appendOutline(input: unknown): OutlineRecord {
    const record = parseInput(
      StudyOutline,
      readProperty(input, "outline write", "record"),
      "study outline",
    )
    const rawParent = readProperty(input, "outline write", "parentRevisionId")
    const parentRevisionId =
      rawParent === null ? null : parseInput(OutlineRevisionId, rawParent, "parent outline ID")
    const brief = this.getBrief(record.briefRevisionId)
    requireBriefApproval(this.context, record.briefRevisionId)
    if (
      brief === null ||
      brief.studyId !== record.studyId ||
      brief.setupRevisionId !== record.setupRevisionId ||
      brief.analysisRevisionId !== record.analysisRevisionId
    ) {
      throw new ContractBoundaryError("outline brief lineage")
    }
    this.validateSpans(
      record.setupRevisionId,
      record.sections.flatMap((section) => section.sources),
      "outline source span",
    )
    return writeRecord("outline revision", record.id, () => {
      this.context.db.transaction((transaction) => {
        transaction
          .insert(outlineRevisions)
          .values({
            id: record.id,
            studyId: record.studyId,
            setupRevisionId: record.setupRevisionId,
            analysisRevisionId: record.analysisRevisionId,
            briefRevisionId: record.briefRevisionId,
            parentRevisionId,
            recordJson: encodeRecord(record),
          })
          .run()
        transaction
          .insert(outlineApprovals)
          .values({
            outlineRevisionId: record.id,
            approvedAt: record.approval.approvedAt,
            recordJson: encodeRecord(record.approval),
          })
          .run()
      })
      return record
    })
  }

  appendLesson(input: unknown): LessonRecord {
    const record = parseInput(
      LessonRevision,
      readProperty(input, "lesson write", "record"),
      "lesson revision",
    )
    const rawParent = readProperty(input, "lesson write", "parentRevisionId")
    const parentRevisionId =
      rawParent === null ? null : parseInput(LessonRevisionId, rawParent, "parent lesson ID")
    const brief = this.getBrief(record.briefRevisionId)
    const outline = this.getOutline(record.outlineRevisionId)
    requireBriefApproval(this.context, record.briefRevisionId)
    if (brief === null || outline === null) {
      throw new ContractBoundaryError("lesson workflow lineage")
    }
    parseInput(WorkflowLineage, { brief, outline, lesson: record }, "workflow lineage")
    const spans = record.sections.flatMap((section) =>
      section.attribution.kind === "author-claim" || section.attribution.kind === "interpretation"
        ? section.attribution.sources
        : [],
    )
    this.validateSpans(
      record.setupRevisionId,
      [...spans, ...record.coverage.sources],
      "lesson source span",
    )
    return writeRecord("lesson revision", record.id, () => {
      this.context.db
        .insert(lessonRevisions)
        .values({
          id: record.id,
          studyId: record.studyId,
          setupRevisionId: record.setupRevisionId,
          analysisRevisionId: record.analysisRevisionId,
          briefRevisionId: record.briefRevisionId,
          outlineRevisionId: record.outlineRevisionId,
          parentRevisionId,
          recordJson: encodeRecord(record),
        })
        .run()
      return record
    })
  }

  appendEvidenceReport(input: unknown): EvidenceRecord {
    const record = parseInput(EvidenceReport, input, "evidence report")
    return writeRecord("evidence report", record.hash, () => {
      this.context.db
        .insert(evidenceReports)
        .values({
          hash: record.hash,
          lessonRevisionId: record.lessonRevisionId,
          recordJson: encodeRecord(record),
        })
        .run()
      return record
    })
  }

  getBrief(input: unknown): BriefRecord | null {
    const id = parseInput(BriefRevisionId, input, "brief revision ID")
    const row = this.context.db.select().from(briefRevisions).where(eq(briefRevisions.id, id)).get()
    return row === undefined
      ? null
      : decodeRecord(ReadingBrief, row.recordJson, "brief revision", id)
  }

  getOutline(input: unknown): OutlineRecord | null {
    const id = parseInput(OutlineRevisionId, input, "outline revision ID")
    const row = this.context.db
      .select()
      .from(outlineRevisions)
      .where(eq(outlineRevisions.id, id))
      .get()
    return row === undefined
      ? null
      : decodeRecord(StudyOutline, row.recordJson, "outline revision", id)
  }

  getLesson(input: unknown): LessonRecord | null {
    const id = parseInput(LessonRevisionId, input, "lesson revision ID")
    const row = this.context.db
      .select()
      .from(lessonRevisions)
      .where(eq(lessonRevisions.id, id))
      .get()
    return row === undefined
      ? null
      : decodeRecord(LessonRevision, row.recordJson, "lesson revision", id)
  }

  private validateSpans(setupId: unknown, spans: readonly unknown[], boundary: string): void {
    const setup = this.sources.getSetup(setupId)
    if (setup === null) throw new ContractBoundaryError(`${boundary} setup`)
    const normalization = this.sources.getNormalization(setup.analysis.normalizationRevisionId)
    if (normalization === null) throw new ContractBoundaryError(`${boundary} normalization`)
    for (const span of spans) parseInput(LocatedSourceSpan, { normalization, span }, boundary)
  }
}
