import { queueQuestions } from "@reading-studio/generation/queue-questions"
import { afterEach, expect, it } from "vitest"
import { advanceQuestionHandoff } from "../src/production-handoffs.ts"
import {
  completeWholeBook,
  fixtureCapacity,
  WholeBookAdapter,
  wholeBookFixture,
  wholeBookWorker,
} from "./whole-book-fixture.ts"

const fixtures: Awaited<ReturnType<typeof wholeBookFixture>>[] = []
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close()
})

it.each(["supported", "overstated"] as const)(
  "keeps the saved-question handoff conditional on the %s verdict",
  async (verdict) => {
    // Given
    const fixture = await wholeBookFixture()
    fixtures.push(fixture)
    const { analysis } = await completeWholeBook(fixture)
    queueQuestions(fixture.storage, "setup-whole", "grant-whole", analysis)
    const run = wholeBookWorker(fixture, new WholeBookAdapter(verdict))
    const grant = fixture.storage.sources.getGrant("grant-whole")
    if (!grant) throw new TypeError("Missing synthetic grant")
    // When
    await run.worker.runNext()
    await run.worker.runNext()
    advanceQuestionHandoff(fixture.storage, grant, {
      localSubscriptions: true,
      capacity: fixtureCapacity,
    })
    // Then
    const bank = fixture.storage.interviews.latest("study-1")
    expect(bank === null).toBe(verdict !== "supported")
    if (bank) expect(bank.steps).toHaveLength(1)
    else expect(fixture.storage.setupScheduling.failure(grant.id)).toBe("analysis-incomplete")
  },
)
