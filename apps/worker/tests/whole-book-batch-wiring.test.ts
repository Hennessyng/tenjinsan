import {
  analysisCacheKey,
  baseAnalysisCacheKey,
  StudySetupRevision,
} from "@reading-studio/contracts"
import { approveBatchedVerification } from "@reading-studio/generation"
import { afterEach, expect, it } from "vitest"
import { bookFixtureTurns } from "./book-map-route-fixture.ts"
import { batchRuntimeFixture, finishBatchRuntime } from "./whole-book-batch-runtime-fixture.ts"
import { batchingFixture } from "./whole-book-batching-fixture.ts"

const fixtures: Awaited<ReturnType<typeof batchingFixture>>[] = []
afterEach(async () => {
  for (const item of fixtures.splice(0)) await item.fixture.close()
})

it("persists a reserve and final cache pointer without self-hashing or accepting a rehashed foreign setup", async () => {
  // Given
  const item = await batchingFixture()
  fixtures.push(item)
  const ready = approveBatchedVerification(item.execution, item.windows, {
    maxFindingBatches: 4,
    cap: 64,
    used: 0,
  })
  if (ready.kind !== "ready") throw new TypeError("Missing admission")
  const raw = {
    ...item.execution.setup,
    batchedVerificationReserve: ready.reserve,
    analysis: {
      ...item.execution.setup.analysis,
      processing: { ...item.execution.setup.analysis.processing, batchReserveId: ready.reserve.id },
    },
  }
  // When
  const parsed = StudySetupRevision.safeParse(raw)
  // Then
  expect(parsed.success).toBe(true)
  if (!parsed.success) throw new TypeError("Failed reserve binding")
  expect(baseAnalysisCacheKey(parsed.data.analysis)).toBe(ready.reserve.analysisKey)
  expect(analysisCacheKey(parsed.data.analysis)).not.toBe(ready.reserve.analysisKey)
  expect(
    StudySetupRevision.safeParse({
      ...raw,
      analysis: {
        ...raw.analysis,
        processing: { ...raw.analysis.processing, batchReserveId: "0".repeat(64) },
      },
    }).success,
  ).toBe(false)
  expect(
    StudySetupRevision.safeParse({
      ...raw,
      analysis: { ...raw.analysis, settings: { ...raw.analysis.settings, maxOutputTokens: 999 } },
    }).success,
  ).toBe(false)
})

it("runs the persisted complete v4 target matrix with exact accounted jobs and native attempts", async () => {
  const item = await batchRuntimeFixture()
  fixtures.push(item)
  const { analysis, adapter } = await finishBatchRuntime(item)
  expect(analysis.status).toBe("successful")
  const state = analysis.wholeBook?.batched
  if (!state?.manifest) throw new TypeError("Missing persisted manifest")
  const windows = state.reserve.windowHashes.length,
    batches = state.manifest.batches.length
  expect(batches).toBeGreaterThan(1)
  const expected = windows * 2 + 1 + (windows + 1) * batches
  const jobs = item.fixture.storage.execution.listSetupJobs(item.setup.id)
  expect(jobs).toHaveLength(expected)
  expect(jobs.every((job) => job.state === "completed")).toBe(true)
  expect(
    jobs.flatMap((job) => item.fixture.storage.execution.listAttempts(job.runId)),
  ).toHaveLength(expected)
  expect(adapter.requests).toHaveLength(expected)
  expect(bookFixtureTurns(item.fixture)).toHaveLength(expected)
  expect(state.receipts).toHaveLength(windows + (windows + 1) * batches)
  expect(expected).toBeLessThanOrEqual(state.reserve.maxAnalysisJobs)
  process.stdout.write(
    `${JSON.stringify({
      event: "wired-v4-counts",
      W: windows,
      B: batches,
      verificationJobs: state.receipts.length,
      analysisJobs: jobs.length,
      attempts: jobs.flatMap((job) => item.fixture.storage.execution.listAttempts(job.runId))
        .length,
      nativeTurns: bookFixtureTurns(item.fixture).length,
      approvedMaxJobs: state.reserve.maxAnalysisJobs,
      approvedTotalAttempts: state.reserve.plannedAttempts,
    })}\n`,
  )
})

it("refuses runtime finding-batch excess atomically without using another job or enlarging consent", async () => {
  const item = await batchRuntimeFixture(1)
  fixtures.push(item)
  const before = item.fixture.storage.sources.getSetup(item.setup.id)
  const { analysis, adapter } = await finishBatchRuntime(item)
  expect(analysis.status).toBe("partial")
  expect(analysis.wholeBook?.phase).toBe("blocked")
  expect(
    analysis.wholeBook?.limitations.some((value) => value.includes("batch-reserve-overflow")),
  ).toBe(true)
  expect(item.fixture.storage.execution.listSetupJobs(item.setup.id)).toHaveLength(3)
  expect(adapter.requests).toHaveLength(3)
  expect(bookFixtureTurns(item.fixture)).toHaveLength(3)
  expect(analysis.wholeBook?.batched?.manifest).toBeNull()
  expect(item.fixture.storage.sources.getSetup(item.setup.id)).toEqual(before)
})
