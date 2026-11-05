import {
  analysisCacheKey,
  BatchedVerificationReserve,
  baseAnalysisCacheKey,
  contentDigest,
  StudySetupRevision,
} from "@reading-studio/contracts"
import {
  approveBatchedVerification,
  prepareBookMapScope,
  proposeNormalBatchedDraft,
} from "@reading-studio/generation"
import { afterEach, expect, it } from "vitest"
import { bookFixtureCapacity } from "./book-map-route-fixture.ts"
import { BatchedRuntimeAdapter } from "./whole-book-batch-runtime-fixture.ts"
import { batchingFixture } from "./whole-book-batching-fixture.ts"
import { wholeBookWorker } from "./whole-book-fixture.ts"

const fixtures: Awaited<ReturnType<typeof batchingFixture>>[] = []
afterEach(async () => {
  for (const item of fixtures.splice(0)) await item.fixture.close()
})
async function given(text?: string) {
  const item = await batchingFixture(text)
  fixtures.push(item)
  const setup = StudySetupRevision.parse({
    ...item.execution.setup,
    analysis: {
      ...item.execution.setup.analysis,
      processing: {
        ...item.execution.setup.analysis.processing,
        capacityId: bookFixtureCapacity.id,
      },
    },
  })
  return { ...item, execution: { ...item.execution, setup, capacity: bookFixtureCapacity } }
}

it("changes reserve/cache identity for the new room policy without changing an old fixed source plan", async () => {
  const item = await given()
  const old = approveBatchedVerification(item.execution, item.windows, {
    maxFindingBatches: 4,
    cap: 64,
    used: 0,
  })
  if (old.kind !== "ready") throw new TypeError("Missing old plan")
  const setup = StudySetupRevision.parse({
    ...item.execution.setup,
    analysis: {
      ...item.execution.setup.analysis,
      processing: {
        ...item.execution.setup.analysis.processing,
        preprocessingVersion: "batched-room-5",
      },
    },
  })
  const current = approveBatchedVerification({ ...item.execution, setup }, item.windows, {
    maxFindingBatches: 4,
    cap: 64,
    used: 0,
  })
  expect(current.kind).toBe("ready")
  if (current.kind !== "ready") throw new TypeError("Missing room plan")
  expect(current.reserve.id).not.toBe(old.reserve.id)
  expect(analysisCacheKey(setup.analysis)).not.toBe(analysisCacheKey(item.execution.setup.analysis))
  expect(
    StudySetupRevision.safeParse({
      ...setup,
      batchedVerificationReserve: old.reserve,
      analysis: {
        ...setup.analysis,
        processing: { ...setup.analysis.processing, batchReserveId: old.reserve.id },
      },
    }).success,
  ).toBe(false)
  expect(prepareBookMapScope(item.execution.setup, item.execution.normalization)).toMatchObject({
    kind: "ready",
  })
  expect(item.execution.setup.analysis.processing?.preprocessingVersion).toBe("batched-capacity-4")
})

it("uses the trusted input counter on complete representative requests, not a byte-to-token estimate", async () => {
  const item = await given()
  const capacity = {
    ...bookFixtureCapacity,
    id: "synthetic-room-small-context",
    contextTokens: 8000,
  }
  const setup = StudySetupRevision.parse({
    ...item.execution.setup,
    analysis: {
      ...item.execution.setup.analysis,
      processing: {
        ...item.execution.setup.analysis.processing,
        preprocessingVersion: "batched-room-5",
        capacityId: capacity.id,
      },
    },
  })
  const before = item.fixture.storage.counts()
  const proposal = await proposeNormalBatchedDraft({
    ...item.execution,
    setup,
    capacity,
    cap: 64,
    used: 0,
  })
  expect(proposal).toEqual({ kind: "limited", reason: "capacity-limit" })
  expect(item.fixture.storage.counts()).toEqual(before)
})

it("rejects a rehashed room-policy label on a granted packed old plan before cache/enqueue/attempt", async () => {
  const item = await given("Synthetic source material. ".repeat(740))
  const old = approveBatchedVerification(item.execution, item.windows, {
    maxFindingBatches: 4,
    cap: 64,
    used: 0,
  })
  if (old.kind !== "ready") throw new TypeError("Old packed witness must fit source-only checks")
  const processing = item.execution.setup.analysis.processing
  if (!processing) throw new TypeError("Missing fixture processing policy")
  const analysis = {
    ...item.execution.setup.analysis,
    processing: { ...processing, preprocessingVersion: "batched-room-5" },
  }
  const { id: _id, ...body } = old.reserve
  const rebound = { ...body, analysisKey: baseAnalysisCacheKey(analysis) }
  const reserve = BatchedVerificationReserve.parse({
    ...rebound,
    id: contentDigest(JSON.stringify(rebound)),
  })
  const setup = item.fixture.storage.sources.appendSetup({
    record: {
      ...item.execution.setup,
      id: "forged-room-plan",
      analysis: { ...analysis, processing: { ...analysis.processing, batchReserveId: reserve.id } },
      batchedVerificationReserve: reserve,
    },
    parentRevisionId: "setup-whole",
  })
  const priorGrant = item.fixture.storage.sources.getGrant("grant-whole")
  if (!priorGrant) throw new TypeError("Missing fixture consent template")
  const grant = item.fixture.storage.sources.appendGrant({
    ...priorGrant,
    id: "grant-forged-room",
    setupRevisionId: setup.id,
  })
  const before = item.fixture.storage.counts()
  const run = wholeBookWorker(item.fixture, new BatchedRuntimeAdapter(), bookFixtureCapacity)
  expect(() => run.pipeline.prepare(setup.id, grant.id)).toThrow("capacity-limit")
  expect(item.fixture.storage.counts()).toEqual(before)
  expect(item.fixture.storage.sources.getSetup(setup.id)).toEqual(setup)
})
