import type {
  AnalysisRevision,
  AnswerSubmission,
  EvidenceReport,
  InputRevisionId,
  LessonRevision,
  PrivacyReview,
  PublicationRevision,
  Question,
  ReadingBrief,
  StudyOutline,
} from "@reading-studio/contracts"
import type { AnalysisRepository } from "./workflow-analysis.ts"
import type { PublicationRepository } from "./workflow-publication.ts"
import type { StudyWorkflowRepository } from "./workflow-study.ts"

export interface WorkflowRepository {
  ensureAnalysisInput(input: unknown): InputRevisionId
  findSuccessfulAnalysis(input: unknown): AnalysisRevision | null
  appendAnalysis(input: unknown): AnalysisRevision
  appendQuestion(input: unknown): Question
  appendAnswer(input: unknown): AnswerSubmission
  appendBrief(input: unknown): ReadingBrief
  appendOutline(input: unknown): StudyOutline
  appendLesson(input: unknown): LessonRevision
  appendEvidenceReport(input: unknown): ReturnType<typeof EvidenceReport.parse>
  appendPrivacyReview(input: unknown): PrivacyReview
  appendPublication(input: unknown): PublicationRevision
  getAnalysis(input: unknown): AnalysisRevision | null
  getQuestion(input: unknown): Question | null
  getOutline(input: unknown): StudyOutline | null
  getLesson(input: unknown): LessonRevision | null
  getAnswer(input: unknown): AnswerSubmission | null
  getPublication(input: unknown): PublicationRevision | null
}

export class SqliteWorkflowRepository implements WorkflowRepository {
  constructor(
    private readonly analyses: AnalysisRepository,
    private readonly study: StudyWorkflowRepository,
    private readonly publications: PublicationRepository,
  ) {}

  ensureAnalysisInput(input: unknown): InputRevisionId {
    return this.analyses.ensureSetupInput(input)
  }

  findSuccessfulAnalysis(input: unknown): AnalysisRevision | null {
    return this.analyses.findSuccessful(input)
  }

  getQuestion(input: unknown): Question | null {
    return this.analyses.getQuestion(input)
  }

  appendAnalysis(input: unknown): AnalysisRevision {
    return this.analyses.append(input)
  }

  appendQuestion(input: unknown): Question {
    return this.analyses.appendQuestion(input)
  }

  appendAnswer(input: unknown): AnswerSubmission {
    return this.analyses.appendAnswer(input)
  }

  appendBrief(input: unknown): ReadingBrief {
    return this.study.appendBrief(input)
  }

  appendOutline(input: unknown): StudyOutline {
    return this.study.appendOutline(input)
  }

  appendLesson(input: unknown): LessonRevision {
    return this.study.appendLesson(input)
  }

  appendEvidenceReport(input: unknown): ReturnType<typeof EvidenceReport.parse> {
    return this.study.appendEvidenceReport(input)
  }

  appendPrivacyReview(input: unknown): PrivacyReview {
    return this.publications.appendPrivacyReview(input)
  }

  appendPublication(input: unknown): PublicationRevision {
    return this.publications.appendPublication(input)
  }

  getAnalysis(input: unknown): AnalysisRevision | null {
    return this.analyses.get(input)
  }

  getOutline(input: unknown): StudyOutline | null {
    return this.study.getOutline(input)
  }

  getLesson(input: unknown): LessonRevision | null {
    return this.study.getLesson(input)
  }

  getAnswer(input: unknown): AnswerSubmission | null {
    return this.analyses.getAnswer(input)
  }

  getPublication(input: unknown): PublicationRevision | null {
    return this.publications.getPublication(input)
  }
}
