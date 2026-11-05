import { BookMapPipeline } from "@reading-studio/generation"
import { afterEach, expect, it } from "vitest"
import { bookFixtureAuthority } from "./book-map-route-fixture.ts"
import { completeWholeBook, wholeBookFixture } from "./whole-book-fixture.ts"

const fixtures: Awaited<ReturnType<typeof wholeBookFixture>>[] = []
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close()
})

it("requires verified route capacity before queuing whole-book processing", async () => {
  // Given
  const fixture = await wholeBookFixture()
  fixtures.push(fixture)
  const { capacity: _capacity, ...authority } = bookFixtureAuthority(fixture)
  const pipeline = new BookMapPipeline(authority)
  // When / Then
  expect(() => pipeline.prepare("setup-whole", "grant-whole")).toThrow("capacity-unknown")
  expect(fixture.storage.counts()).toMatchObject({ jobs: 0, attempts: 0 })
})

it("finishes only after complete maps, synthesis and original-passage verdicts", async () => {
  // Given
  const fixture = await wholeBookFixture()
  fixtures.push(fixture)
  // When
  const { analysis, pipeline, adapter } = await completeWholeBook(fixture)
  // Then
  expect(analysis.status).toBe("successful")
  expect(analysis.wholeBook?.phase).toBe("complete")
  expect(analysis.wholeBook?.synthesis?.strategy).toBe("complete-maps-and-original")
  expect(analysis.wholeBook?.verification).toHaveLength(2)
  expect(adapter.requests).toHaveLength(4)
  expect(pipeline.prepare("setup-whole", "grant-whole").id).toBe(analysis.id)
  expect(adapter.requests).toHaveLength(4)
})
