import {
  AnalysisRevision,
  bookMapProjection,
  chapterFindings,
  contentDigest,
} from "@reading-studio/contracts"
import { afterEach, expect, it } from "vitest"
import { completeWholeBook, wholeBookFixture } from "./whole-book-fixture.ts"

const fixtures: Awaited<ReturnType<typeof wholeBookFixture>>[] = []
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close()
})

it("rejects fabricated original fragments hidden in rich chapter maps", async () => {
  // Given
  const fixture = await wholeBookFixture()
  fixtures.push(fixture)
  const { analysis } = await completeWholeBook(fixture)
  const data = analysis.wholeBook
  if (!data) throw new TypeError("Missing preparation")
  const maps = data.maps.map((map) => ({
    ...map,
    summary: {
      ...map.summary,
      sources: map.summary.sources.map((span) => ({
        ...span,
        originalFragment: "Fabricated original",
      })),
    },
  }))
  const forged = {
    ...data,
    maps,
    verification: data.verification.map((check, index) => {
      const map = maps[index]
      return map
        ? { ...check, targetHash: contentDigest(JSON.stringify(chapterFindings(map))) }
        : check
    }),
  }
  // When / Then
  expect(() =>
    fixture.storage.workflow.appendAnalysis({
      record: {
        ...analysis,
        id: `map-${contentDigest("forged-rich-map")}`,
        ...bookMapProjection(forged),
        wholeBook: forged,
      },
      parentRevisionId: null,
    }),
  ).toThrow()
})

it("rejects semantic verdicts that do not bind the exact interpretations", async () => {
  // Given
  const fixture = await wholeBookFixture()
  fixtures.push(fixture)
  const { analysis } = await completeWholeBook(fixture)
  const data = analysis.wholeBook
  if (!data) throw new TypeError("Missing preparation")
  // When
  const result = AnalysisRevision.safeParse({
    ...analysis,
    wholeBook: {
      ...data,
      verification: data.verification.map((check) => ({
        ...check,
        targetHash: "another-target",
        decisions: [],
      })),
    },
  })
  // Then
  expect(result.success).toBe(false)
})
