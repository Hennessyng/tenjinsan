import { afterEach, expect, it } from "vitest"
import { analysisEvaluationRuntime } from "../src/analysis-evaluation-runtime.ts"
import { advanceProductionStage, recoverQuestionHandoffs } from "../src/production-handoffs.ts"
import { analysisPurposeFixture } from "./analysis-purpose-fixture.ts"
import { analysisNativeReplies } from "./analysis-purpose-native.ts"
import { bookFixtureAuthority, bookFixtureTurns } from "./book-map-route-fixture.ts"

const fixtures: Awaited<ReturnType<typeof analysisPurposeFixture>>[] = []
afterEach(async () => {
  for (const item of fixtures.splice(0)) await item.fixture.close()
})
async function given() {
  const item = await analysisPurposeFixture()
  fixtures.push(item)
  return item
}
const runtime = (item: Awaited<ReturnType<typeof given>>) =>
  analysisEvaluationRuntime({
    ...bookFixtureAuthority(item.fixture),
    clock: () => new Date("2026-10-23T00:00:00.000Z"),
  })
async function finish(run: ReturnType<typeof runtime>) {
  let value = await run.step()
  for (let step = 0; step < 20 && value.kind === "pending"; step++) value = await run.step()
  return value
}

it("enforces terminal completion across generic handoffs, replay and restart", async () => {
  const item = await given()
  analysisNativeReplies(item)
  const first = runtime(item)
  expect((await first.step()).kind).toBe("pending")
  expect(item.fixture.storage.liveStudyGuard.used()).toBe(1)
  await item.reopen()
  analysisNativeReplies(item)
  const run = runtime(item),
    result = await finish(run)
  expect(result.kind).toBe("verified-analysis")
  const before = item.fixture.storage.counts(),
    turns = bookFixtureTurns(item.fixture).length
  for (const job of item.fixture.storage.execution.listSetupJobs(item.setup.id))
    advanceProductionStage(item.fixture.storage, job, bookFixtureAuthority(item.fixture))
  recoverQuestionHandoffs(item.fixture.storage, true)
  expect((await run.step()).kind).toBe("verified-analysis")
  expect(item.fixture.storage.counts()).toEqual(before)
  expect(bookFixtureTurns(item.fixture)).toHaveLength(turns)
  expect(turns).toBe(5)
  expect(before).toMatchObject({
    questions: 0,
    answers: 0,
    briefs: 0,
    outlines: 0,
    lessons: 0,
    publications: 0,
    artifacts: 0,
  })
})
it("charges the existing schema repair within two slots, not as extra free work", async () => {
  const item = await given()
  analysisNativeReplies(item, { repairFirst: true })
  expect((await finish(runtime(item))).kind).toBe("verified-analysis")
  expect(item.fixture.storage.liveStudyGuard.used()).toBe(6)
  const first = item.fixture.storage.execution.listSetupJobs(item.setup.id)[0]
  if (!first) throw new TypeError("Missing repaired map")
  expect(item.fixture.storage.execution.listAttempts(first.runId)).toHaveLength(2)
  expect(bookFixtureTurns(item.fixture)).toHaveLength(6)
})
it("pauses unknown work without automatic replay; explicit retry cannot free or exceed two slots", async () => {
  const item = await given()
  analysisNativeReplies(item, { lose: 2 })
  const run = runtime(item)
  expect((await run.step()).kind).toBe("awaiting-owner")
  expect((await run.step()).kind).toBe("awaiting-owner")
  expect(bookFixtureTurns(item.fixture)).toHaveLength(1)
  const job = item.fixture.storage.execution.listSetupJobs(item.setup.id)[0]
  if (!job) throw new TypeError("Missing uncertain map")
  const first = item.fixture.storage.execution.listAttempts(job.runId)[0]
  if (!first) throw new TypeError("Missing unknown charge")
  item.fixture.storage.execution.resolveUnknownAttempt({
    attemptId: first.id,
    resolution: "retry-approved",
  })
  expect((await run.step()).kind).toBe("awaiting-owner")
  const second = item.fixture.storage.execution.listAttempts(job.runId)[1]
  if (!second) throw new TypeError("Missing second unknown charge")
  item.fixture.storage.execution.resolveUnknownAttempt({
    attemptId: second.id,
    resolution: "retry-approved",
  })
  expect((await run.step()).kind).toBe("blocked")
  expect(item.fixture.storage.execution.listAttempts(job.runId)).toHaveLength(2)
  expect(item.fixture.storage.liveStudyGuard.used()).toBe(2)
  expect(bookFixtureTurns(item.fixture)).toHaveLength(2)
})
it("cancels without dispatching or promoting the terminal", async () => {
  const item = await given()
  item.runtime().pipeline.prepare(item.setup.id, item.grant.id)
  const job = item.fixture.storage.execution.listSetupJobs(item.setup.id)[0]
  if (!job) throw new TypeError("Missing queued map")
  item.fixture.storage.execution.requestCancellation({ jobId: job.id })
  expect((await runtime(item).step()).kind).toBe("cancelled")
  expect(item.fixture.storage.liveStudyGuard.used()).toBe(0)
  expect(bookFixtureTurns(item.fixture)).toHaveLength(0)
})
it("resumes a single explicitly resolved unknown without refunding its first charge", async () => {
  const item = await given()
  analysisNativeReplies(item, { lose: 1 })
  const run = runtime(item)
  expect((await run.step()).kind).toBe("awaiting-owner")
  const job = item.fixture.storage.execution.listSetupJobs(item.setup.id)[0]
  const attempt = job && item.fixture.storage.execution.listAttempts(job.runId)[0]
  if (!attempt) throw new TypeError("Missing explicit retry charge")
  item.fixture.storage.execution.resolveUnknownAttempt({
    attemptId: attempt.id,
    resolution: "retry-approved",
  })
  expect((await finish(run)).kind).toBe("verified-analysis")
  expect(item.fixture.storage.liveStudyGuard.used()).toBe(6)
  expect(bookFixtureTurns(item.fixture)).toHaveLength(6)
})
it("stops an explicitly resolved unknown and keeps its spend in the shared source ledger", async () => {
  const item = await given()
  analysisNativeReplies(item, { lose: 1 })
  const run = runtime(item)
  expect((await run.step()).kind).toBe("awaiting-owner")
  const job = item.fixture.storage.execution.listSetupJobs(item.setup.id)[0]
  const attempt = job && item.fixture.storage.execution.listAttempts(job.runId)[0]
  if (!attempt) throw new TypeError("Missing unknown stop charge")
  item.fixture.storage.execution.resolveUnknownAttempt({
    attemptId: attempt.id,
    resolution: "stop-approved",
  })
  expect((await run.step()).kind).toBe("cancelled")
  expect(item.fixture.storage.liveStudyGuard.used()).toBe(1)
  expect(item.fixture.storage.liveStudyBudget.status(item.target.budgetId)).toMatchObject({
    used: 1,
    remaining: 19,
  })
  expect(bookFixtureTurns(item.fixture)).toHaveLength(1)
})
