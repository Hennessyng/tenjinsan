import { afterEach, expect, it } from "vitest"
import { completeWholeBook, wholeBookFixture } from "./whole-book-fixture.ts"

const fixtures: Awaited<ReturnType<typeof wholeBookFixture>>[] = []
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close()
})

it("checks current consent before reusing a successful cached analysis", async () => {
  // Given
  const fixture = await wholeBookFixture()
  fixtures.push(fixture)
  const { analysis, pipeline, adapter } = await completeWholeBook(fixture)
  const setup = fixture.storage.sources.getSetup("setup-whole")
  if (!setup) throw new TypeError("Missing setup")
  fixture.storage.sources.appendSetup({
    record: { ...setup, id: "changed-setup" },
    parentRevisionId: setup.id,
  })
  // When / Then
  expect(() => pipeline.prepare("setup-whole", "grant-whole")).toThrow("unauthorized")
  expect(fixture.storage.workflow.getAnalysis(analysis.id)).toEqual(analysis)
  expect(adapter.requests).toHaveLength(4)
})
