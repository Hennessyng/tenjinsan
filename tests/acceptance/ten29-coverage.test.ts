import { afterEach, expect, it } from "vitest"
import { wholeBookFixture, wholeBookWorker } from "../../apps/worker/tests/whole-book-fixture.ts"
import { prepareBookRoute } from "./ten29/portable-fixtures.ts"

const fixtures: Awaited<ReturnType<typeof wholeBookFixture>>[] = []
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close()
})

it("keeps unprocessed maps unsent and synthesis unavailable when a map is omitted", async () => {
  // Given
  const fixture = await wholeBookFixture("Synthetic bounded source. ".repeat(600), 3)
  fixtures.push(fixture)
  prepareBookRoute(fixture)
  const { pipeline, worker, adapter } = wholeBookWorker(fixture)
  const planned = pipeline.prepare("setup-whole", "grant-whole")
  expect(planned.wholeBook?.parts.length).toBeGreaterThan(1)
  expect(planned.wholeBook?.parts.every((part) => part.status === "unsent")).toBe(true)
  expect(fixture.storage.counts().attempts).toBe(0)
  // When: execute only one map; deliberately omit the remaining planned maps.
  await worker.runNext()
  const incomplete = pipeline.prepare("setup-whole", "grant-whole")
  // Then
  expect(incomplete.status).toBe("partial")
  expect(incomplete.wholeBook?.phase).toBe("mapping")
  expect(incomplete.wholeBook?.parts.some((part) => part.status === "complete")).toBe(true)
  expect(incomplete.wholeBook?.parts.some((part) => part.status === "unsent")).toBe(true)
  expect(incomplete.wholeBook?.synthesis).toBeNull()
  expect(incomplete.wholeBook?.maps).toHaveLength(1)
  expect(adapter.requests).toHaveLength(1)
  expect(fixture.storage.workflow.findSuccessfulAnalysis(incomplete.cacheKey)).toBeNull()
})
