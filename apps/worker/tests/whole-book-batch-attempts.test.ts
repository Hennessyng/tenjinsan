import {
  LocalSubscriptionAdapter,
  ProviderError,
  type StructuredRequest,
} from "@reading-studio/providers"
import { afterEach, expect, it, vi } from "vitest"
import { z } from "zod"
import { bookFixtureTurns } from "./book-map-route-fixture.ts"
import {
  BatchedRuntimeAdapter,
  batchAtVerification,
  batchRuntimeFixture,
  finishBatchRuntime,
} from "./whole-book-batch-runtime-fixture.ts"

const fixtures: Awaited<ReturnType<typeof batchRuntimeFixture>>[] = []
afterEach(async () => {
  for (const item of fixtures.splice(0)) await item.fixture.close()
})
const header = (request: StructuredRequest) => {
  const payload = z
    .array(z.unknown())
    .parse(JSON.parse(request.prompt.slice(request.prompt.lastIndexOf("\n") + 1)))
  return z.object({ kind: z.string(), task: z.string().optional() }).parse(payload[0])
}

it("charges an actually transmitted lost reply once and preserves manifest/reserve across repeated prepare", async () => {
  const item = await batchRuntimeFixture()
  fixtures.push(item)
  const run = await batchAtVerification(item)
  const native = LocalSubscriptionAdapter.prototype.dispatch
  let lost = false
  vi.spyOn(LocalSubscriptionAdapter.prototype, "dispatch").mockImplementation(async function (
    this: LocalSubscriptionAdapter,
    request,
  ) {
    const result = await native.call(this, request)
    if (!lost && header(request)?.kind === "batched-original-verification") {
      lost = true
      throw new ProviderError("outcome-unknown")
    }
    return result
  })
  const calls = bookFixtureTurns(item.fixture).length
  await run.worker.runNext()
  const jobs = item.fixture.storage.execution.listSetupJobs(item.setup.id)
  const paused = jobs.find((job) => job.state === "paused")
  if (!paused) throw new TypeError("Missing uncertain batch")
  expect(item.fixture.storage.execution.listAttempts(paused.runId)).toMatchObject([
    { state: "outcome_unknown" },
  ])
  expect(bookFixtureTurns(item.fixture)).toHaveLength(calls + 1)
  const first = run.pipeline.prepare(item.setup.id, item.grant.id)
  const second = run.pipeline.prepare(item.setup.id, item.grant.id)
  expect(second.wholeBook?.batched?.manifestHash).toBe(first.wholeBook?.batched?.manifestHash)
  expect(second.wholeBook?.batched?.reserve).toEqual(item.reserve)
  expect(second.wholeBook?.allowance.used).toBe(calls + 1)
  expect(item.fixture.storage.execution.listSetupJobs(item.setup.id)).toHaveLength(jobs.length)
  expect(bookFixtureTurns(item.fixture)).toHaveLength(calls + 1)
})

it("meters the complete repair request and charges its second attempt without another job or allowance", async () => {
  const item = await batchRuntimeFixture()
  fixtures.push(item)
  class RepairAdapter extends BatchedRuntimeAdapter {
    repaired = false
    override async dispatch(request: StructuredRequest) {
      const result = await super.dispatch(request)
      if (!this.repaired && header(request)?.task === "map-omission") {
        this.repaired = true
        return { ...result, text: "{}" }
      }
      return result
    }
  }
  const measured: StructuredRequest[] = []
  const original = LocalSubscriptionAdapter.prototype.measure
  vi.spyOn(LocalSubscriptionAdapter.prototype, "measure").mockImplementation(async function (
    this: LocalSubscriptionAdapter,
    request,
  ) {
    measured.push(request)
    return original.call(this, request)
  })
  const { analysis, adapter } = await finishBatchRuntime(item, new RepairAdapter())
  expect(analysis.status).toBe("successful")
  const jobs = item.fixture.storage.execution.listSetupJobs(item.setup.id)
  const attempts = jobs.flatMap((job) => item.fixture.storage.execution.listAttempts(job.runId))
  expect(attempts).toHaveLength(jobs.length + 1)
  expect(bookFixtureTurns(item.fixture)).toHaveLength(attempts.length)
  expect(adapter.requests).toHaveLength(attempts.length)
  expect(measured.length).toBeGreaterThanOrEqual(attempts.length)
  for (const dispatched of adapter.requests)
    expect(
      measured.some(
        (request) =>
          request.prompt === dispatched.prompt &&
          JSON.stringify(request.schema) === JSON.stringify(dispatched.schema),
      ),
    ).toBe(true)
  expect(adapter.requests.filter((request) => request.schemaRepair !== undefined)).toHaveLength(1)
  expect(measured.some((request) => request.schemaRepair !== undefined)).toBe(true)
  const repaired = jobs.find(
    (job) => item.fixture.storage.execution.listAttempts(job.runId).length === 2,
  )
  if (!repaired) throw new TypeError("Missing repaired batch job")
  const stageRequests = adapter.requests.filter(
    (request) => header(request)?.task === "map-omission",
  )
  expect(new Set(stageRequests.map((request) => request.prompt)).size).toBeGreaterThan(2)
  expect(
    jobs.filter((job) => item.fixture.storage.execution.listAttempts(job.runId).length === 2),
  ).toHaveLength(1)
  expect(analysis.wholeBook?.batched?.reserve).toEqual(item.reserve)
  expect(attempts.length).toBeLessThanOrEqual(item.reserve.maxAnalysisJobs * 2)
})
