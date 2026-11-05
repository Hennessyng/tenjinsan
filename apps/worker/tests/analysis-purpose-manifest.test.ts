import { analysisCacheKey, foundationJobIdentity } from "@reading-studio/contracts"
import { planBatchedVerification } from "@reading-studio/generation"
import { afterEach, expect, it } from "vitest"
import { analysisPurposeFixture } from "./analysis-purpose-fixture.ts"
import { bookFixtureCapacity, bookFixtureTurns } from "./book-map-route-fixture.ts"

const fixtures: Awaited<ReturnType<typeof analysisPurposeFixture>>[] = []
afterEach(async () => {
  for (const item of fixtures.splice(0)) await item.fixture.close()
})
async function given() {
  const item = await analysisPurposeFixture()
  fixtures.push(item)
  const run = item.runtime()
  run.pipeline.prepare(item.setup.id, item.grant.id)
  await run.worker.runNext()
  run.pipeline.prepare(item.setup.id, item.grant.id)
  await run.worker.runNext()
  const analysis = run.pipeline.prepare(item.setup.id, item.grant.id)
  const job = item.fixture.storage.execution
    .listSetupJobs(item.setup.id)
    .find((job) => job.foundationTask?.kind === "verification")
  if (job?.foundationTask?.kind !== "verification")
    throw new TypeError("Missing signed verification proof")
  return { item, analysis, job, manifest: job.foundationTask.manifest }
}
it("rejects a foreign matrix target index before any verification attempt", async () => {
  const { item, job } = await given(),
    before = item.fixture.storage.counts()
  expect(() =>
    item.fixture.storage.liveStudyGuard.assertJob({
      ...job,
      foundationTask: { ...job.foundationTask, index: 999 },
    }),
  ).toThrow()
  expect(item.fixture.storage.counts()).toEqual(before)
  expect(bookFixtureTurns(item.fixture)).toHaveLength(2)
})
it("rejects a fully rehashed matrix whose synthesis is not the completed native result", async () => {
  const { item, job, manifest } = await given()
  const progression = manifest.synthesis.progression.map((finding, index) =>
    index === 0
      ? { ...finding, text: "Foreign retained synthesis, not the native result" }
      : finding,
  )
  const planned = planBatchedVerification(
    { setup: item.setup, normalization: item.normalization, capacity: bookFixtureCapacity },
    {
      reserve: manifest.reserve,
      windows: manifest.targets
        .filter((target) => target.kind === "map-omission")
        .map((target) => target.originals),
    },
    { maps: manifest.maps, synthesis: { ...manifest.synthesis, progression } },
  )
  if (planned.kind !== "ready") throw new TypeError("Rehashed witness must be structurally valid")
  const target = planned.manifest.targets[0]
  if (!target) throw new TypeError("Missing foreign target")
  const id = foundationJobIdentity(
    item.setup.id,
    item.grant.id,
    analysisCacheKey(item.setup.analysis),
    `batch-${target.id}`,
    0,
  )
  item.fixture.storage.execution.appendRun({
    id,
    inputRevisionId: job.inputRevisionId,
    budget: { maxCalls: 2 },
    reservedCalls: 0,
    state: "running",
  })
  const before = item.fixture.storage.counts()
  expect(() =>
    item.fixture.storage.execution.appendJob({
      ...job,
      id,
      runId: id,
      foundationTask: { kind: "verification", index: 0, manifest: planned.manifest },
    }),
  ).toThrow()
  expect(item.fixture.storage.counts()).toEqual(before)
  expect(bookFixtureTurns(item.fixture)).toHaveLength(2)
})
