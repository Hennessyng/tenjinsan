import {
  AnalysisQuestionSet,
  Answer,
  AnswerSubmission,
  analysisCacheKey,
  InputRevisionId,
  InterviewDefinition,
  OwnerId,
  StudyId,
} from "@reading-studio/contracts"
import { z } from "zod"
import type { StorageContext } from "./database.ts"
import { ContractBoundaryError } from "./errors.ts"
import type { SourceRepository } from "./sources.ts"
import type { AnalysisRepository } from "./workflow-analysis.ts"

const Row = z.object({ record_json: z.string() })
export class InterviewRepository {
  constructor(
    private readonly context: StorageContext,
    private readonly sources: SourceRepository,
    private readonly analyses: AnalysisRepository,
  ) {}

  create(input: unknown): InterviewDefinition {
    const definition = InterviewDefinition.parse(input)
    const analysis = this.analyses.get(definition.analysisRevisionId)
    const setup = this.sources.getLatestSetup(definition.studyId)
    if (setup && analysis?.cacheKey !== analysisCacheKey(setup.analysis))
      throw new ContractBoundaryError("interview analysis differs from current setup")
    if (
      analysis?.status !== "successful" ||
      !this.sources
        .listStudiesByEdition(analysis.editionId)
        .some((study) => study.id === definition.studyId)
    )
      throw new ContractBoundaryError("interview analysis lineage")
    AnalysisQuestionSet.parse({
      analysis,
      questionSet: {
        analysisRevisionId: definition.analysisRevisionId,
        questions: definition.steps.map((step) => step.question),
      },
    })
    this.context.sqlite
      .prepare("INSERT INTO interview_definitions (id, study_id, record_json) VALUES (?, ?, ?)")
      .run(definition.id, definition.studyId, JSON.stringify(definition))
    return definition
  }

  latest(input: unknown): InterviewDefinition | null {
    const studyId = StudyId.parse(input)
    const row = this.context.sqlite
      .prepare(
        "SELECT record_json FROM interview_definitions WHERE study_id = ? ORDER BY sequence DESC LIMIT 1",
      )
      .get(studyId)
    return row ? InterviewDefinition.parse(JSON.parse(Row.parse(row).record_json)) : null
  }

  listOwned(input: unknown): readonly InterviewDefinition[] {
    const ownerId = OwnerId.parse(input)
    const rows = this.context.sqlite
      .prepare(
        "SELECT d.record_json FROM interview_definitions d JOIN studies s ON s.id = d.study_id WHERE s.owner_id = ? AND d.sequence = (SELECT MAX(sequence) FROM interview_definitions WHERE study_id = d.study_id) ORDER BY d.sequence DESC",
      )
      .all(ownerId)
    return rows.map((row) => InterviewDefinition.parse(JSON.parse(Row.parse(row).record_json)))
  }

  owned(studyId: unknown, ownerId: string): InterviewDefinition | null {
    const definition = this.latest(studyId)
    if (!definition) return null
    const analysis = this.analyses.get(definition.analysisRevisionId)
    return analysis &&
      this.sources
        .listStudiesByEdition(analysis.editionId)
        .some((study) => study.id === definition.studyId && study.ownerId === ownerId)
      ? definition
      : null
  }

  answers(input: unknown): readonly AnswerSubmission[] {
    const id = InputRevisionId.parse(input)
    const rows = this.context.sqlite
      .prepare("SELECT record_json FROM interview_answers WHERE interview_id = ? ORDER BY sequence")
      .all(id)
    const answers = new Map<string, AnswerSubmission>()
    for (const row of rows) {
      const submission = AnswerSubmission.parse(JSON.parse(Row.parse(row).record_json))
      answers.set(submission.question.id, submission)
    }
    return [...answers.values()]
  }

  save(input: unknown): AnswerSubmission {
    const write = z
      .strictObject({ studyId: StudyId, interviewId: InputRevisionId, answer: Answer })
      .parse(input)
    return this.context.sqlite.transaction(() => {
      const definition = this.latest(write.studyId)
      const step = definition?.steps.find((step) => step.question.id === write.answer.questionId)
      if (!definition || definition.id !== write.interviewId || !step)
        throw new ContractBoundaryError("stale interview")
      const setup = this.sources.getLatestSetup(write.studyId)
      const analysis = this.analyses.get(definition.analysisRevisionId)
      if (setup && analysis?.cacheKey !== analysisCacheKey(setup.analysis))
        throw new ContractBoundaryError("interview analysis differs from current setup")
      const submission = AnswerSubmission.parse({ question: step.question, answer: write.answer })
      this.context.sqlite
        .prepare(
          "INSERT INTO interview_answers (interview_id, question_id, record_json) VALUES (?, ?, ?)",
        )
        .run(definition.id, step.question.id, JSON.stringify(submission))
      return submission
    })()
  }
}
