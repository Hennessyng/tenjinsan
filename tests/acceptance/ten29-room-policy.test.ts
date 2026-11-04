import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { validatedBatchedSetupSources } from "@reading-studio/contracts"
import { ChapterOutput, verificationRoomAssessment } from "@reading-studio/generation"
import type { StructuredRequest } from "@reading-studio/providers"
import {
  legacyLocalReservationBytes as localRequestBytes,
  requestFitsCapacity,
} from "@reading-studio/providers"
import { expect, it } from "vitest"
import { z } from "zod"
import { bookFixtureCapacity } from "../../apps/worker/tests/book-map-route-fixture.ts"
import { BatchedRuntimeAdapter } from "../../apps/worker/tests/whole-book-batch-runtime-fixture.ts"
import { batchingFixture } from "../../apps/worker/tests/whole-book-batching-fixture.ts"
import { evidenceDirectory } from "./ten29/evidence.ts"
import { exerciseNormalV4 } from "./ten29/normal-v4-fixture.ts"

const books = [
  {
    language: "en",
    text: "The workshop records a general rule: regular practice improves accuracy. A later trial qualifies it: fatigue and unfamiliar tools can reverse the result. The final discussion keeps both the benefit and that limit.\n\n".repeat(
      220,
    ),
  },
  {
    language: "ja",
    text: "工房の記録では、練習を続けると作業が正確になると説明する。後の実験では、疲労や不慣れな道具によって結果が逆転した。結論は、利点とその条件の両方を残している。\n\n".repeat(
      360,
    ),
  },
] as const
const directory = await evidenceDirectory("room-policy-medium")
it.each(books)(
  "admits and completes the previously over-cap medium $language normal plan with representative outputs",
  async ({ language, text }) => {
    // Given
    const item = await batchingFixture(text)
    const adapter = new BatchedRuntimeAdapter()
    try {
      // When
      const result = await exerciseNormalV4(
        { ...item.fixture, normalization: item.execution.normalization },
        adapter,
      )
      await writeFile(join(directory, `${language}.json`), JSON.stringify(result, null, 2), {
        flag: "wx",
      })
      // Then
      expect(result.kind).toBe("processed")
      if (result.kind !== "processed") throw new TypeError("Medium room-aware plan refused")
      expect(result.setup.analysis.processing?.preprocessingVersion).toBe("batched-room-5")
      expect(result.review).toMatchObject({
        preparation: {
          verificationRoom: { policy: "batched-room-5", targetBytes: 12288, sampleOnly: true },
        },
      })
      expect(result.analysis.status).toBe("successful")
      const state = result.analysis.wholeBook?.batched
      if (!state?.manifest) throw new TypeError("Missing completed matrix")
      expect(state.reserve.windowHashes.length).toBeGreaterThanOrEqual(2)
      expect(state.reserve.windowHashes.length).toBeLessThanOrEqual(8)
      expect(state.reserve.plannedAttempts).toBeLessThanOrEqual(64)
      expect(state.manifest.batches.length).toBeLessThanOrEqual(state.reserve.maxFindingBatches)
      expect(item.fixture.storage.sources.getSetup(result.setup.id)).toEqual(result.setup)
      const windows = validatedBatchedSetupSources(result.setup, item.execution.normalization)
      const room = windows.map((originals, index) =>
        verificationRoomAssessment(
          {
            setup: result.setup,
            normalization: item.execution.normalization,
            capacity: bookFixtureCapacity,
          },
          {
            originals,
            groupId: result.setup.analysis.processing?.plan?.[index]?.groupId ?? "structural",
          },
        ),
      )
      expect(
        room.every(
          (value) =>
            value.fits &&
            value.measurements &&
            value.measurements.emptyMap.freeBytes >= 12288 &&
            value.measurements.emptyFindings.freeBytes >= 12288,
        ),
      ).toBe(true)
      for (const resource of item.execution.normalization.resources)
        if (resource.status === "included")
          for (const block of resource.blocks) {
            expect(
              windows
                .flat()
                .filter((span) => span.resourcePath === resource.path && span.blockId === block.id)
                .map((span) => span.originalFragment)
                .join(""),
            ).toBe(block.text)
          }
      const requests = adapter.requests.map((request) => ({
        bytes: localRequestBytes("chatgpt-subscription", request),
        inputTokens: bookFixtureCapacity.countInputTokens(request),
        fits: requestFitsCapacity(
          request,
          localRequestBytes("chatgpt-subscription", request),
          bookFixtureCapacity,
        ),
      }))
      expect(requests.every((request) => request.fits && request.bytes <= 32000)).toBe(true)
      expect(result.native.length).toBe(result.jobs.length)
      await writeFile(
        join(directory, `${language}-requests.json`),
        JSON.stringify(
          {
            requests,
            room,
            W: state.reserve.windowHashes.length,
            B: state.manifest.batches.length,
            signedMaxAttempts: state.reserve.plannedAttempts,
            nativeTurns: result.native.length,
            semanticAssessment: "NOT RUN; authored protocol outputs",
          },
          null,
          2,
        ),
        { flag: "wx" },
      )
    } finally {
      await item.fixture.close()
    }
  },
  60000,
)

it("refuses an oversized indivisible generated map without truncating or enlarging its signed plan", async () => {
  const item = await batchingFixture(books[0].text)
  class OversizedOwnMap extends BatchedRuntimeAdapter {
    private changed = false
    override async dispatch(request: StructuredRequest) {
      const result = await super.dispatch(request)
      const payload = z
        .array(z.unknown())
        .parse(JSON.parse(request.prompt.slice(request.prompt.lastIndexOf("\n") + 1)))
      const header = z.object({ kind: z.string() }).parse(payload[0])
      if (this.changed || header.kind !== "chapter-map" || result.kind !== "output") return result
      this.changed = true
      const output = ChapterOutput.parse(JSON.parse(result.text))
      const summary = output.summary
      const rich = { ...summary, text: "a".repeat(1600) }
      return {
        ...result,
        text: JSON.stringify(
          ChapterOutput.parse({
            ...output,
            purpose: rich,
            summary: rich,
            claims: Array.from({ length: 6 }, () => rich),
          }),
        ),
      }
    }
  }
  try {
    const result = await exerciseNormalV4(
      { ...item.fixture, normalization: item.execution.normalization },
      new OversizedOwnMap(),
    )
    await writeFile(join(directory, "indivisible-map.json"), JSON.stringify(result, null, 2), {
      flag: "wx",
    })
    expect(result.kind).toBe("processed")
    if (result.kind !== "processed") throw new TypeError("Expected admitted representative plan")
    expect(result.analysis.status).toBe("partial")
    expect(
      result.analysis.wholeBook?.limitations.some((reason) =>
        reason.includes("indivisible-map-omission-overflow"),
      ),
    ).toBe(true)
    expect(result.jobs).toHaveLength(
      (result.setup.batchedVerificationReserve?.windowHashes.length ?? 0) + 1,
    )
    expect(result.native.length).toBe(result.jobs.length)
    expect(item.fixture.storage.sources.getSetup(result.setup.id)).toEqual(result.setup)
    expect(result.analysis.wholeBook?.batched?.manifest).toBeNull()
    expect(result.analysis.wholeBook?.maps[0]?.claims).toHaveLength(6)
    expect(
      result.analysis.wholeBook?.maps[0]?.claims.every((finding) => finding.text.length === 1600),
    ).toBe(true)
  } finally {
    await item.fixture.close()
  }
}, 60000)

it("does not turn the six-finding operating sample into a semantic output cap", async () => {
  const item = await batchingFixture(books[0].text)
  try {
    const result = await exerciseNormalV4(
      { ...item.fixture, normalization: item.execution.normalization },
      new BatchedRuntimeAdapter("not-addressed", 10),
    )
    await writeFile(join(directory, "ten-findings.json"), JSON.stringify(result, null, 2), {
      flag: "wx",
    })
    expect(result.kind).toBe("processed")
    if (result.kind !== "processed") throw new TypeError("Medium plan unexpectedly refused")
    expect(result.analysis.status).toBe("successful")
    expect(
      (result.analysis.wholeBook?.synthesis?.thesis.length ?? 0) +
        (result.analysis.wholeBook?.synthesis?.progression.length ?? 0),
    ).toBe(10)
    expect(result.analysis.wholeBook?.batched?.manifest?.batches.length).toBeGreaterThan(1)
    expect(item.fixture.storage.sources.getSetup(result.setup.id)).toEqual(result.setup)
  } finally {
    await item.fixture.close()
  }
}, 60000)
