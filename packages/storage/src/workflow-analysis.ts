import {
  AnalysisQuestionSet,
  type AnalysisRevision as AnalysisRecord,
  AnalysisRevision,
  AnalysisRevisionId,
  type AnswerSubmission as AnswerRecord,
  AnswerSubmission,
  contentDigest,
  Digest,
  InputRevisionId,
  LocatedSourceSpan,
  Question,
  type Question as QuestionRecord,
  QuestionRevisionId,
  StudyId,
} from "@reading-studio/contracts"
import { eq } from "drizzle-orm"
import type { StorageContext } from "./database.ts"
import { ContractBoundaryError } from "./errors.ts"
import { decodeRecord, encodeRecord, parseInput, readProperty, writeRecord } from "./records.ts"
import {
  analysisRevisions,
  answerRevisions,
  inputRevisions,
  questionRevisions,
} from "./schema/index.ts"
import type { SourceRepository } from "./sources.ts"

export class AnalysisRepository {
  constructor(
    private readonly context: StorageContext,
    private readonly sources: SourceRepository,
  ) {}

  ensureSetupInput(input: unknown): ReturnType<typeof InputRevisionId.parse> {
    const setup = this.sources.getSetup(input)
    if (!setup) throw new ContractBoundaryError("analysis setup input")
    const id = InputRevisionId.parse(`analysis-${contentDigest(setup.id)}`)
    const existing = this.context.db
      .select()
      .from(inputRevisions)
      .where(eq(inputRevisions.id, id))
      .get()
    if (existing) {
      if (existing.studyId !== setup.studyId || existing.kind !== "setup")
        throw new ContractBoundaryError("analysis input collision")
      return id
    }
    this.context.db
      .insert(inputRevisions)
      .values({ id, studyId: setup.studyId, parentRevisionId: null, kind: "setup" })
      .run()
    return id
  }

  findSuccessful(input: unknown): AnalysisRecord | null {
    const key = parseInput(Digest, input, "analysis cache key")
    const rows = this.context.db
      .select()
      .from(analysisRevisions)
      .where(eq(analysisRevisions.cacheKey, key))
      .all()
    const row = rows.find((row) => row.status === "successful")
    return row ? decodeRecord(AnalysisRevision, row.recordJson, "analysis revision", row.id) : null
  }

  append(input: unknown): AnalysisRecord {
    const rawParent = readProperty(input, "analysis write", "parentRevisionId")
    const record = parseInput(
      AnalysisRevision,
      readProperty(input, "analysis write", "record"),
      "analysis revision",
    )
    const parentRevisionId =
      rawParent === null
        ? null
        : parseInput(AnalysisRevisionId, rawParent, "parent analysis revision ID")
    const normalization = this.sources.getNormalization(record.cacheInput.normalizationRevisionId)
    if (
      normalization === null ||
      normalization.editionId !== record.editionId ||
      normalization.editionHash !== record.cacheInput.editionHash
    ) {
      throw new ContractBoundaryError("analysis normalization lineage")
    }
    for (const finding of [...record.claims, ...record.concepts, ...record.qualifications]) {
      for (const span of finding.sources) {
        parseInput(LocatedSourceSpan, { normalization, span }, "analysis source span")
      }
    }
    return writeRecord("analysis revision", record.id, () => {
      this.context.db
        .insert(analysisRevisions)
        .values({
          id: record.id,
          editionId: record.editionId,
          normalizationRevisionId: record.cacheInput.normalizationRevisionId,
          parentRevisionId,
          cacheKey: record.cacheKey,
          status: record.status,
          recordJson: encodeRecord(record),
        })
        .run()
      return record
    })
  }

  appendQuestion(input: unknown): QuestionRecord {
    const rawParent = readProperty(input, "question write", "parentRevisionId")
    const record = parseInput(
      Question,
      readProperty(input, "question write", "record"),
      "question revision",
    )
    const parentRevisionId =
      rawParent === null
        ? null
        : parseInput(QuestionRevisionId, rawParent, "parent question revision ID")
    const analysis = this.get(record.analysisRevisionId)
    if (analysis === null) throw new ContractBoundaryError("question analysis lineage")
    parseInput(
      AnalysisQuestionSet,
      { analysis, questionSet: { analysisRevisionId: analysis.id, questions: [record] } },
      "analysis question set",
    )
    return writeRecord("question revision", record.revisionId, () => {
      this.context.db
        .insert(questionRevisions)
        .values({
          revisionId: record.revisionId,
          questionId: record.id,
          analysisRevisionId: record.analysisRevisionId,
          parentRevisionId,
          recordJson: encodeRecord(record),
        })
        .run()
      return record
    })
  }

  appendAnswer(input: unknown): AnswerRecord {
    const id = parseInput(
      InputRevisionId,
      readProperty(input, "answer write", "id"),
      "input revision ID",
    )
    const studyId = parseInput(StudyId, readProperty(input, "answer write", "studyId"), "study ID")
    const rawParent = readProperty(input, "answer write", "parentRevisionId")
    const parentRevisionId =
      rawParent === null ? null : parseInput(InputRevisionId, rawParent, "parent input revision ID")
    const submitted = parseInput(
      AnswerSubmission,
      readProperty(input, "answer write", "submission"),
      "answer submission",
    )
    const question = this.getQuestion(submitted.answer.questionRevisionId)
    if (question === null) throw new ContractBoundaryError("answer question lineage")
    const record = parseInput(
      AnswerSubmission,
      { question, answer: submitted.answer },
      "authoritative answer submission",
    )
    return writeRecord("answer revision", id, () => {
      this.context.db.transaction((transaction) => {
        transaction
          .insert(inputRevisions)
          .values({ id, studyId, parentRevisionId, kind: "answer" })
          .run()
        transaction
          .insert(answerRevisions)
          .values({
            id,
            questionRevisionId: record.question.revisionId,
            questionId: record.question.id,
            recordJson: encodeRecord(record),
          })
          .run()
      })
      return record
    })
  }

  get(input: unknown): AnalysisRecord | null {
    const id = parseInput(AnalysisRevisionId, input, "analysis revision ID")
    const row = this.context.db
      .select()
      .from(analysisRevisions)
      .where(eq(analysisRevisions.id, id))
      .get()
    return row === undefined
      ? null
      : decodeRecord(AnalysisRevision, row.recordJson, "analysis revision", id)
  }

  getQuestion(input: unknown): QuestionRecord | null {
    const id = parseInput(QuestionRevisionId, input, "question revision ID")
    const row = this.context.db
      .select()
      .from(questionRevisions)
      .where(eq(questionRevisions.revisionId, id))
      .get()
    return row === undefined
      ? null
      : decodeRecord(Question, row.recordJson, "question revision", id)
  }

  getAnswer(input: unknown): AnswerRecord | null {
    const id = parseInput(InputRevisionId, input, "input revision ID")
    const row = this.context.db
      .select()
      .from(answerRevisions)
      .where(eq(answerRevisions.id, id))
      .get()
    return row === undefined
      ? null
      : decodeRecord(AnswerSubmission, row.recordJson, "answer revision", id)
  }
}
