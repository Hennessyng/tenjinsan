import { afterEach, expect, it } from "vitest"
import { completeWholeBook, WholeBookAdapter, wholeBookFixture } from "./whole-book-fixture.ts"

const fixtures: Awaited<ReturnType<typeof wholeBookFixture>>[] = []
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close()
})

it("retains explicit no-claim maps without inventing an argument", async () => {
  // Given
  const fixture = await wholeBookFixture("References: Synthetic A; Synthetic B.")
  fixtures.push(fixture)
  // When
  const { analysis } = await completeWholeBook(fixture, new WholeBookAdapter("supported", true))
  // Then
  expect(analysis.status).toBe("successful")
  expect(analysis.wholeBook?.maps[0]?.claimStatus).toBe("no-claim")
  expect(analysis.claims).toEqual([])
  expect(analysis.wholeBook?.maps[0]?.summary.sources[0]?.originalFragment).toBe("References: ")
})

it("blocks overstated interpretations despite valid JSON and exact source offsets", async () => {
  // Given
  const fixture = await wholeBookFixture()
  fixtures.push(fixture)
  // When
  const { analysis } = await completeWholeBook(fixture, new WholeBookAdapter("overstated"))
  // Then
  expect(analysis.status).toBe("partial")
  expect(analysis.wholeBook?.phase).toBe("blocked")
  expect(fixture.storage.workflow.findSuccessfulAnalysis(analysis.cacheKey)).toBeNull()
  expect(
    analysis.wholeBook?.verification
      .flatMap((check) => check.decisions)
      .every((decision) => decision.verdict === "overstated"),
  ).toBe(true)
})
