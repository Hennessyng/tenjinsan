import {
  BatchedVerificationManifest,
  type BatchedVerificationReceipt,
  BookSynthesis,
  batchedVerificationComplete,
  ChapterPartMap,
} from "@reading-studio/contracts"
import { approveBatchedVerification, planBatchedVerification } from "@reading-studio/generation"
import { afterEach, expect, it } from "vitest"
import { batchingFixture } from "./whole-book-batching-fixture.ts"

const fixtures: Awaited<ReturnType<typeof batchingFixture>>[] = []
afterEach(async () => {
  for (const item of fixtures.splice(0)) await item.fixture.close()
})
async function proposed(maxFindingBatches = 4) {
  const item = await batchingFixture()
  fixtures.push(item)
  const approved = approveBatchedVerification(item.execution, item.windows, {
    maxFindingBatches,
    cap: 64,
    used: 0,
  })
  if (approved.kind !== "ready")
    throw new TypeError(`Unexpected admission refusal: ${approved.reason}`)
  return { ...item, approved: { reserve: approved.reserve, windows: item.windows } }
}

it("packs all findings across every source window and citation task without enlarging the signed reserve", async () => {
  // Given
  const item = await proposed()
  const before = item.fixture.storage.counts()
  // When
  const result = planBatchedVerification(item.execution, item.approved, item.outputs)
  // Then
  expect(result.kind).toBe("ready")
  if (result.kind !== "ready") throw new TypeError(result.reason)
  process.stdout.write(
    `${JSON.stringify({
      event: "v4-unwired-batch-plan",
      windows: item.windows.length,
      actualFindingBatches: result.manifest.batches.length,
      maxFindingBatches: item.approved.reserve.maxFindingBatches,
      materializedTargets: result.manifest.targets.length,
      reservedAnalysisJobs: item.approved.reserve.maxAnalysisJobs,
      reservedAttemptsIncludingLater: item.approved.reserve.plannedAttempts,
      largestActualRequestBytes: Math.max(...result.requests.map((entry) => entry.bytes)),
      configuredRequestByteLimit: item.execution.capacity.maxRequestBytes,
      newJobs: item.fixture.storage.counts().jobs - before.jobs,
    })}\n`,
  )
  expect(result.manifest.batches.length).toBeGreaterThan(1)
  expect(result.manifest.batches.length).toBeLessThanOrEqual(
    item.approved.reserve.maxFindingBatches,
  )
  expect(result.manifest.targets).toHaveLength(
    item.windows.length + (item.windows.length + 1) * result.manifest.batches.length,
  )
  expect(new Set(result.manifest.targets.map((target) => target.id)).size).toBe(
    result.manifest.targets.length,
  )
  expect(
    result.requests.every((entry) => entry.bytes <= item.execution.capacity.maxRequestBytes),
  ).toBe(true)
  expect(item.fixture.storage.counts()).toEqual(before)
})

it("refuses a finding-batch overflow rather than truncating candidates or allocating new jobs", async () => {
  const item = await proposed(1)
  const result = planBatchedVerification(item.execution, item.approved, item.outputs)
  expect(result).toMatchObject({ kind: "limited", reason: "batch-reserve-overflow" })
})

it("refuses known source/partition/budget overflow before consent without side effects", async () => {
  const item = await proposed()
  expect(
    approveBatchedVerification(item.execution, item.windows, {
      maxFindingBatches: 100,
      cap: 64,
      used: 0,
    }),
  ).toMatchObject({ kind: "limited", reason: "attempt-budget-limit" })
  expect(
    approveBatchedVerification(item.execution, item.windows.slice(1), {
      maxFindingBatches: 1,
      cap: 64,
      used: 0,
    }),
  ).toMatchObject({ kind: "limited", reason: "invalid-source-partition" })
  expect(
    approveBatchedVerification(
      { ...item.execution, capacity: { ...item.execution.capacity, maxRequestBytes: 100 } },
      item.windows,
      { maxFindingBatches: 1, cap: 64, used: 0 },
    ),
  ).toMatchObject({ kind: "limited", reason: "known-source-overflow" })
})

it("requires every exact matrix target and only permits global window-local not-addressed", async () => {
  const item = await proposed()
  const result = planBatchedVerification(item.execution, item.approved, item.outputs)
  expect(result.kind).toBe("ready")
  if (result.kind !== "ready") throw new TypeError(result.reason)
  const receipts: BatchedVerificationReceipt[] = result.manifest.targets.map((target) => ({
    targetId: target.id,
    output: {
      decisions: target.findingIds.map((id) => ({
        id,
        verdict: target.kind === "window-findings" ? "not-addressed" : "supported",
        explanation: "Authored state, not semantic truth",
      })),
      mapCoverage:
        target.kind === "map-omission"
          ? { verdict: "none", explanation: "Authored no omission", sources: [] }
          : null,
    },
  }))
  expect(batchedVerificationComplete(result.manifest, receipts)).toBe(true)
  expect(batchedVerificationComplete(result.manifest, receipts.slice(1))).toBe(false)
  expect(
    batchedVerificationComplete(
      result.manifest,
      [...receipts.slice(1), receipts[1]].filter((receipt) => receipt !== undefined),
    ),
  ).toBe(false)
  expect(
    BatchedVerificationManifest.safeParse({
      ...result.manifest,
      targets: result.manifest.targets.slice(1),
    }).success,
  ).toBe(false)
  const blocked = receipts.map((receipt) => ({
    ...receipt,
    output: {
      ...receipt.output,
      decisions: receipt.output.decisions.map((decision) => ({
        ...decision,
        verdict: "not-addressed" as const,
      })),
    },
  }))
  expect(batchedVerificationComplete(result.manifest, blocked)).toBe(false)
  const materialOmission = receipts.map((receipt, index) =>
    index === 0
      ? {
          ...receipt,
          output: {
            ...receipt.output,
            mapCoverage: {
              verdict: "uncertain" as const,
              explanation: "Authored review needed",
              sources: [],
            },
          },
        }
      : receipt,
  )
  expect(batchedVerificationComplete(result.manifest, materialOmission)).toBe(false)
})

it("refuses indivisible findings/citations and whole-map omission reviews instead of silently fragmenting them", async () => {
  const item = await proposed()
  const first = item.outputs.synthesis.thesis[0]
  if (!first) throw new TypeError("Missing global finding")
  const large = { ...first, sources: Array.from({ length: 32 }, () => first.sources[0]) }
  const synthesis = BookSynthesis.parse({ ...item.outputs.synthesis, thesis: [large] })
  expect(
    planBatchedVerification(item.execution, item.approved, { ...item.outputs, synthesis }),
  ).toMatchObject({ kind: "limited", reason: "indivisible-finding-or-citation-overflow" })
  const map = item.outputs.maps[0],
    claim = map?.claims[0]
  if (!map || !claim) throw new TypeError("Missing own-map finding")
  const oversizedMap = ChapterPartMap.parse({
    ...map,
    claims: [
      {
        ...claim,
        text: "x".repeat(2000),
        sources: Array.from({ length: 32 }, () => claim.sources[0]),
      },
    ],
  })
  expect(
    planBatchedVerification(item.execution, item.approved, {
      ...item.outputs,
      maps: [oversizedMap, ...item.outputs.maps.slice(1)],
    }),
  ).toMatchObject({ kind: "limited", reason: "indivisible-map-omission-overflow" })
})
