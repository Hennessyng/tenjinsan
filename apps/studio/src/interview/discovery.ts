import {
  type AnalysisRevisionId,
  type Bilingual,
  type InputRevisionId,
  InterviewDefinition,
  type Question,
  type QuestionId,
  type StudyId,
} from "@reading-studio/contracts"

export function interviewFromDiscovery(input: {
  readonly id: InputRevisionId
  readonly bank: {
    readonly studyId: StudyId
    readonly analysisRevisionId: AnalysisRevisionId
    readonly contextRevisionId: InputRevisionId
    readonly groups: readonly { readonly id: string; readonly label: Bilingual }[]
    readonly lenses: readonly { readonly groupId: string; readonly question: Question }[]
    readonly shortlist: readonly QuestionId[]
  }
}): InterviewDefinition {
  const { bank } = input
  return InterviewDefinition.parse({
    id: input.id,
    studyId: bank.studyId,
    analysisRevisionId: bank.analysisRevisionId,
    contextRevisionId: bank.contextRevisionId,
    groups: bank.groups,
    shortlist: bank.shortlist,
    steps: bank.lenses.map((lens) => ({
      groupId: lens.groupId,
      purpose: "preference",
      question: lens.question,
    })),
  })
}
