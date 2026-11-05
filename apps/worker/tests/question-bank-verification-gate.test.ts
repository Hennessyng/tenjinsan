import { queueQuestions } from "@reading-studio/generation/queue-questions"
import { afterEach, expect, it } from "vitest"
import { completeWholeBook, wholeBookFixture } from "./whole-book-fixture.ts"

const fixtures: Awaited<ReturnType<typeof wholeBookFixture>>[] = []
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close()
})

it("does not expose a new bank until interpretations pass original-passage checks", async () => {
  // Given
  const fixture = await wholeBookFixture()
  fixtures.push(fixture)
  const { analysis, worker } = await completeWholeBook(fixture)
  queueQuestions(fixture.storage, "setup-whole", "grant-whole", analysis)
  // When
  const result = await worker.runNext()
  // Then
  expect(result.kind).toBe("provider")
  expect(fixture.storage.interviews.latest("study-1")).toBeNull()
  expect(
    fixture.storage.execution
      .listSetupJobs("setup-whole")
      .some((job) => job.id.startsWith("check-") && job.state === "queued"),
  ).toBe(true)
})
