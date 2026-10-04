import {
  type AnalysisRevision,
  OutlineContent,
  type OutlineFeedback,
  type ReadingBrief,
} from "@reading-studio/contracts"

export type OutlineRequest = {
  readonly brief: ReadingBrief
  readonly analysis: AnalysisRevision
  readonly previous: OutlineContent | null
  readonly feedback: OutlineFeedback | null
}
export type OutlineFixtureProvider = (input: OutlineRequest) => OutlineContent

export const fixtureOutlineProvider: OutlineFixtureProvider = ({
  brief,
  analysis,
  previous,
  feedback,
}) => {
  const sources = [...analysis.claims, ...analysis.concepts].flatMap((finding) => finding.sources)
  const content =
    previous ??
    OutlineContent.parse({
      title: brief.guidingQuestion,
      theme: { en: `A question-led study: ${brief.purpose}`, ja: "問いを軸に、根拠と限界を考える" },
      sections: [brief.guidingQuestion, ...brief.supportingQuestions].map((question, index) => ({
        id: `section-${index + 1}`,
        title: question,
        theme: brief.guidingQuestion,
        questionIndex: index,
        learningGoals: [question],
        sources,
        visualIntents: [
          {
            en: "Compare the question, source evidence and its limits side by side.",
            ja: "問い・根拠・限界を並べて比較する。",
          },
        ],
        visualKind: "illustrative-model",
        visualEvidence: [],
        flags: [],
      })),
      qualifications: analysis.qualifications,
      excludedAreas: brief.exclusions,
    })
  if (!feedback) return content
  switch (feedback.kind) {
    case "custom":
      return OutlineContent.parse({
        ...content,
        sections: content.sections.map((section) => ({
          ...section,
          visualIntents: [{ en: feedback.text, ja: "読者が指定した表現案（原文を参照）" }],
          visualKind: "illustrative-model",
          visualEvidence: [],
        })),
      })
    case "choice":
      switch (feedback.value) {
        case "reverse-order":
          return OutlineContent.parse({ ...content, sections: [...content.sections].reverse() })
        case "simplify-visuals":
          return OutlineContent.parse({
            ...content,
            sections: content.sections.map((section) => ({
              ...section,
              visualKind: "illustrative-model",
              visualEvidence: [],
              flags: section.flags.filter((flag) => flag !== "unsupported-visual"),
              visualIntents: [
                {
                  en: "A labelled evidence table; no numerical claim.",
                  ja: "根拠を示す表。数値による主張はしない。",
                },
              ],
            })),
          })
        default: {
          const exhaustive: never = feedback.value
          return exhaustive
        }
      }
    default: {
      const exhaustive: never = feedback
      return exhaustive
    }
  }
}
