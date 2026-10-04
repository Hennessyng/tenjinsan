import {
  AnalysisCacheInput,
  AnalysisRevision,
  analysisCacheKey,
  OutlineFeedback,
  ReadingBrief,
} from "@reading-studio/contracts"
import { fixtureOutlineProvider } from "@reading-studio/generation/outline"
import { completeGraphFixtures } from "@reading-studio/storage/test-support"
import { expect, it } from "vitest"

const graph = completeGraphFixtures()
const brief = ReadingBrief.parse(graph.brief)
const analysis = AnalysisRevision.parse({
  ...graph.analysis,
  cacheKey: analysisCacheKey(AnalysisCacheInput.parse(graph.analysis.cacheInput)),
  qualifications: graph.analysis.claims.map((claim) => ({
    ...claim,
    id: `limit-${claim.id}`,
    text: "Applies only within the selected evidence.",
  })),
})

it("retains qualifications and question links when generating a fixture outline", () => {
  // Given
  const request = { brief, analysis, previous: null, feedback: null }
  // When
  const outline = fixtureOutlineProvider(request)
  // Then
  expect(outline.title).toEqual(brief.guidingQuestion)
  expect(outline.qualifications).toEqual(analysis.qualifications)
  expect(outline.excludedAreas).toEqual(brief.exclusions)
  expect(outline.sections.map((section) => section.questionIndex)).toEqual([
    0,
    ...brief.supportingQuestions.map((_, index) => index + 1),
  ])
  expect(
    outline.sections.every(
      (section) => section.sources.length > 0 && section.visualKind === "illustrative-model",
    ),
  ).toBe(true)
})

it("reverses only section order when the reader selects reverse order", () => {
  // Given
  const previous = fixtureOutlineProvider({ brief, analysis, previous: null, feedback: null })
  // When
  const revised = fixtureOutlineProvider({
    brief,
    analysis,
    previous,
    feedback: OutlineFeedback.parse({ kind: "choice", value: "reverse-order" }),
  })
  // Then
  expect(revised.sections).toEqual([...previous.sections].reverse())
  expect(revised.qualifications).toEqual(analysis.qualifications)
})

it("preserves custom visual intention literally when a reader supplies one", () => {
  // Given
  const text = "Use two panels: what I heard / what I inferred. 聞いたこと・推測したこと。"
  // When
  const outline = fixtureOutlineProvider({
    brief,
    analysis,
    previous: null,
    feedback: OutlineFeedback.parse({ kind: "custom", text }),
  })
  // Then
  expect(outline.sections[0]?.visualIntents[0]?.en).toBe(text)
  expect(outline.sections[0]?.visualKind).toBe("illustrative-model")
})
