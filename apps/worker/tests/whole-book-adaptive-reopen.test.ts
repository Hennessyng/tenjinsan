import { openStorage } from "@reading-studio/storage"
import { afterEach, expect, it } from "vitest"
import {
  completeWholeBook,
  WholeBookAdapter,
  wholeBookFixture,
  wholeBookWorker,
} from "./whole-book-fixture.ts"

const fixtures: Awaited<ReturnType<typeof wholeBookFixture>>[] = []
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close()
})

it("completes a multi-part plan after reopen without replaying completed work", async () => {
  // Given
  const fixture = await wholeBookFixture(
    "A synthetic argument and its qualification. ".repeat(1000),
  )
  fixtures.push(fixture)
  const setup = fixture.storage.sources.getSetup("setup-whole")
  const parts = setup?.analysis.processing?.plan
  if (!parts) throw new TypeError("Missing approved adaptive plan")
  expect(parts.length).toBeGreaterThan(1)
  const adapter = new WholeBookAdapter()
  const initial = wholeBookWorker(fixture, adapter)
  initial.pipeline.prepare("setup-whole", "grant-whole")
  await initial.worker.runNext()
  expect(adapter.requests).toHaveLength(1)
  fixture.storage.close()
  fixture.storage = openStorage(fixture)
  // When
  const { analysis } = await completeWholeBook(fixture, adapter)
  // Then
  expect(analysis.status).toBe("successful")
  expect(analysis.wholeBook?.phase).toBe("complete")
  expect(analysis.wholeBook?.parts.map((part) => part.ranges)).toEqual(
    parts.map((part) => part.ranges),
  )
  expect(adapter.requests).toHaveLength(parts.length * 2 + 2)
})
