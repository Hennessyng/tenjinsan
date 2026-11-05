import { openStorage } from "@reading-studio/storage"
import { afterEach, expect, it, vi } from "vitest"
import { bookFixtureTurns, closeBookRoute } from "./book-map-route-fixture.ts"
import {
  BatchedRuntimeAdapter,
  batchAtVerification,
  batchRuntimeFixture,
  finishBatchRuntime,
} from "./whole-book-batch-runtime-fixture.ts"
import { wholeBookWorker } from "./whole-book-fixture.ts"

const fixtures: Awaited<ReturnType<typeof batchRuntimeFixture>>[] = []
afterEach(async () => {
  for (const item of fixtures.splice(0)) await item.fixture.close()
})

it("reopens a persisted matrix without repacking or replaying completed batch jobs and reuses only its bound cache", async () => {
  const item = await batchRuntimeFixture()
  fixtures.push(item)
  const run = await batchAtVerification(item)
  await run.worker.runNext()
  const partial = run.pipeline.prepare(item.setup.id, item.grant.id)
  const hash = partial.wholeBook?.batched?.manifestHash
  const ids = item.fixture.storage.execution.listSetupJobs(item.setup.id).map((job) => job.id)
  await closeBookRoute(item.fixture.storage)
  item.fixture.storage.close()
  item.fixture.storage = openStorage(item.fixture)
  const result = await finishBatchRuntime(item, run.adapter)
  const cached = result.pipeline.prepare(item.setup.id, item.grant.id)
  expect(result.analysis.status).toBe("successful")
  expect(result.analysis.wholeBook?.batched?.manifestHash).toBe(hash)
  expect(item.fixture.storage.execution.listSetupJobs(item.setup.id).map((job) => job.id)).toEqual(
    ids,
  )
  expect(bookFixtureTurns(item.fixture)).toHaveLength(ids.length)
  expect(cached).toEqual(result.analysis)
  expect(item.fixture.storage.sources.getSetup(item.setup.id)).toEqual(item.setup)
})

it("keeps a cancelled batch and its missing verdict blocking without increasing batches or jobs", async () => {
  const item = await batchRuntimeFixture()
  fixtures.push(item)
  const run = await batchAtVerification(item)
  const queued = item.fixture.storage.execution
    .listSetupJobs(item.setup.id)
    .find((job) => job.state === "queued")
  if (!queued) throw new TypeError("Missing batch job")
  item.fixture.storage.execution.requestCancellation({ jobId: queued.id })
  await run.worker.runNext()
  const result = run.pipeline.prepare(item.setup.id, item.grant.id)
  expect(result.status).toBe("partial")
  expect(result.wholeBook?.phase).toBe("blocked")
  expect(result.wholeBook?.batched?.manifestHash).toBe(
    run.analysis.wholeBook?.batched?.manifestHash,
  )
  expect(result.wholeBook?.batched?.reserve).toEqual(item.reserve)
  expect(item.fixture.storage.execution.listSetupJobs(item.setup.id)).toHaveLength(
    run.analysis.wholeBook?.batched?.manifest?.targets.length
      ? run.analysis.wholeBook.batched.manifest.targets.length + 3
      : 0,
  )
})

it("rolls back the entire manifest/job materialization if one authorized job write fails", async () => {
  const item = await batchRuntimeFixture()
  fixtures.push(item)
  const run = wholeBookWorker(item.fixture, new BatchedRuntimeAdapter(), item.execution.capacity)
  let analysis = run.pipeline.prepare(item.setup.id, item.grant.id)
  while (analysis.wholeBook?.phase !== "synthesizing") {
    await run.worker.runNext()
    analysis = run.pipeline.prepare(item.setup.id, item.grant.id)
  }
  await run.worker.runNext()
  const before = item.fixture.storage.counts()
  const original = item.fixture.storage.execution.appendJob.bind(item.fixture.storage.execution)
  let writes = 0
  const spy = vi.spyOn(item.fixture.storage.execution, "appendJob").mockImplementation((value) => {
    if (++writes === 2) throw new Error("Synthetic atomic materialization interruption")
    return original(value)
  })
  expect(() => run.pipeline.prepare(item.setup.id, item.grant.id)).toThrow()
  expect(item.fixture.storage.counts()).toEqual(before)
  expect(
    item.fixture.storage.workflow.findBatchedAnalysis(
      analysis.cacheKey,
      item.setup.id,
      item.grant.id,
    ),
  ).toBeNull()
  spy.mockRestore()
  expect(run.pipeline.prepare(item.setup.id, item.grant.id).wholeBook?.phase).toBe("verifying")
})
