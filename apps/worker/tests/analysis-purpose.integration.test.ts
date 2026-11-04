import { afterEach, expect, it } from "vitest"
import { analysisPurposeFixture } from "./analysis-purpose-fixture.ts"
import { bookFixtureTurns } from "./book-map-route-fixture.ts"

const fixtures: Awaited<ReturnType<typeof analysisPurposeFixture>>[] = []
afterEach(async () => {
  for (const item of fixtures.splice(0)) await item.fixture.close()
})
async function given() {
  const item = await analysisPurposeFixture()
  fixtures.push(item)
  return item
}
it("admits W1/B3 with18 attempts through the real20 guard and completes only verified analysis", async () => {
  const item = await given(),
    { pipeline, worker } = item.runtime()
  expect(item.setup.batchedVerificationReserve).toMatchObject({
    maxFindingBatches: 3,
    plannedAttempts: 18,
    reservedLaterAttempts: 0,
    cap: 20,
    budgetPolicy: "analysis-evaluation-reserve-1",
  })
  let value = pipeline.prepare(item.setup.id, item.grant.id)
  for (let step = 0; step < 20 && value.status !== "successful"; step++) {
    await worker.runNext()
    value = pipeline.prepare(item.setup.id, item.grant.id)
  }
  expect(
    value.status,
    JSON.stringify({
      limitations: value.wholeBook?.limitations,
      jobs: item.fixture.storage.execution.listSetupJobs(item.setup.id).map((job) => ({
        id: job.id,
        state: job.state,
        error: job.state === "failed" ? job.error : null,
      })),
    }),
  ).toBe("successful")
  expect(value.wholeBook?.terminal).toBe("verified-analysis")
  expect(item.fixture.storage.liveStudyGuard.used()).toBe(5)
  expect(bookFixtureTurns(item.fixture)).toHaveLength(5)
  expect(item.fixture.storage.execution.listSetupJobs(item.setup.id)).toHaveLength(5)
  expect(item.fixture.storage.counts()).toMatchObject({
    questions: 0,
    answers: 0,
    outlines: 0,
    lessons: 0,
    publications: 0,
    artifacts: 0,
  })
  expect(item.fixture.storage.sources.getSetup(item.setup.id)).toEqual(item.setup)
})
it("does not admit the evaluation through the unguarded generic64 path", async () => {
  const item = await given()
  await item.reopen(false)
  const before = item.fixture.storage.counts()
  expect(() => item.runtime().pipeline.prepare(item.setup.id, item.grant.id)).toThrow()
  expect(item.fixture.storage.counts()).toEqual(before)
})
it.each(["questions", "outline", "lesson", "publication", "artifact", "analysis"] as const)(
  "refuses a forged non-foundation %s job before attempts",
  async (stage) => {
    const item = await given(),
      { pipeline } = item.runtime()
    pipeline.prepare(item.setup.id, item.grant.id)
    const original = item.fixture.storage.execution.listSetupJobs(item.setup.id)[0]
    if (!original) throw new TypeError("Missing authorized map template")
    item.fixture.storage.execution.appendRun({
      id: `forged-${stage}`,
      inputRevisionId: original.inputRevisionId,
      budget: { maxCalls: 20 },
      reservedCalls: 0,
      state: "running",
    })
    const before = item.fixture.storage.counts()
    expect(() =>
      item.fixture.storage.execution.appendJob({
        ...original,
        id: `check-forged-${stage}`,
        runId: `forged-${stage}`,
        stage,
        foundationTask: undefined,
      }),
    ).toThrow()
    expect(item.fixture.storage.counts()).toEqual(before)
    expect(bookFixtureTurns(item.fixture)).toHaveLength(0)
  },
)
