import { afterEach, expect, it } from "vitest"
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

it("retains complete maps when the full original cannot accompany synthesis", async () => {
  // Given
  const fixture = await wholeBookFixture("日".repeat(1500), 10)
  fixtures.push(fixture)
  // When
  const { analysis, adapter } = await completeWholeBook(fixture)
  // Then
  expect(analysis.status).toBe("successful")
  expect(analysis.wholeBook?.synthesis?.strategy).toBe("complete-maps")
  const synthesis = adapter.requests.find((request) =>
    request.prompt.includes('"kind":"book-synthesis"'),
  )
  if (!synthesis) throw new TypeError("Missing synthetic synthesis request")
  const payload: unknown = JSON.parse(
    synthesis.prompt.slice(synthesis.prompt.lastIndexOf("\n") + 1),
  )
  expect(payload).toEqual([
    expect.objectContaining({
      maps: expect.arrayContaining([...(analysis.wholeBook?.maps ?? [])]),
    }),
  ])
})

it.each(["book-synthesis", "original-verification"])(
  "refuses %s token overflow without publishing a question bank",
  async (kind) => {
    // Given
    const fixture = await wholeBookFixture()
    fixtures.push(fixture)
    const run = wholeBookWorker(fixture, new WholeBookAdapter(), {
      ...fixtureCapacity,
      countInputTokens: (request) => (request.prompt.includes(`"kind":"${kind}"`) ? 100_000 : 1000),
    })
    let analysis = run.pipeline.prepare("setup-whole", "grant-whole")
    // When
    for (let step = 0; step < 12 && (await run.worker.runNext()).kind !== "idle"; step++)
      analysis = run.pipeline.prepare("setup-whole", "grant-whole")
    // Then
    expect(analysis.status).toBe("partial")
    expect(analysis.wholeBook?.phase).toBe("blocked")
    expect(fixture.storage.execution.listSetupJobs("setup-whole")).toContainEqual(
      expect.objectContaining({
        state: "failed",
        error: expect.objectContaining({ code: "capacity-limit" }),
      }),
    )
    expect(fixture.storage.interviews.latest("study-1")).toBeNull()
  },
)
