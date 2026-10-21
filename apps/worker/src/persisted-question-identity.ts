import {
  contentDigest,
  QuestionId,
  type QuestionId as QuestionIdValue,
  QuestionRevisionId,
  type QuestionRevisionId as QuestionRevisionIdValue,
  type StudySetupRevision,
} from "@reading-studio/contracts"

export function persistedQuestionIdentity(input: {
  readonly setup: StudySetupRevision
  readonly analysisRevisionId: string
  readonly contextRevisionId: string
  readonly position: number
}): { readonly id: QuestionIdValue; readonly revisionId: QuestionRevisionIdValue } {
  const scope = JSON.stringify([
    input.setup.studyId,
    input.setup.id,
    input.analysisRevisionId,
    input.contextRevisionId,
    input.position,
  ])
  const digest = contentDigest(scope)
  return {
    id: QuestionId.parse(`question-${digest}`),
    revisionId: QuestionRevisionId.parse(`question-revision-${digest}`),
  }
}
