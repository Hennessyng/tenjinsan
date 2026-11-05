import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { BATCHED_VERIFICATION_VERSION } from "@reading-studio/contracts"
import { expect, it } from "vitest"
import { BatchedRuntimeAdapter } from "../../apps/worker/tests/whole-book-batch-runtime-fixture.ts"
import { corpus, extract, formats } from "./ten29/corpus-support.ts"
import { evidenceDirectory } from "./ten29/evidence.ts"
import { exerciseNormalV4 } from "./ten29/normal-v4-fixture.ts"
import { persistedCorpus } from "./ten29/persisted-corpus.ts"
import { persistedSource } from "./ten29/persisted-source.ts"

const directory = await evidenceDirectory("normal-v4-default-plan")
const cases = corpus.flatMap((family) => formats.map((format) => ({ family, format })))
it.each(cases)(
  "uses normal HTTP/default planner for $family.id/$format with declared rich fake outputs",
  async ({ family, format }) => {
    const fixture = await persistedCorpus(family, format, { draftOnly: true })
    try {
      const result = await exerciseNormalV4(fixture)
      await writeFile(
        join(directory, `${family.id}-${format}.json`),
        JSON.stringify(
          { ...result, semanticScores: "NOT RUN; fake authored output/state" },
          null,
          2,
        ),
        { flag: "wx", mode: 0o600 },
      )
      expect(result.kind).toBe("processed")
      if (result.kind !== "processed") throw new TypeError("Corpus unexpectedly refused")
      expect(result.setup.analysis.processing?.synthesisVersion).toBe(BATCHED_VERIFICATION_VERSION)
      expect(result.analysis.status).toBe("successful")
      const state = result.analysis.wholeBook?.batched
      if (!state?.manifest) throw new TypeError("Missing matrix")
      expect(state.reserve.outputFitGuaranteed).toBe(false)
      expect(result.jobs).toHaveLength(
        state.reserve.windowHashes.length + 1 + state.manifest.targets.length,
      )
      expect(result.native).toHaveLength(result.jobs.length)
      expect(result.requests).toBe(result.native.length)
      expect(state.manifest.batches.length).toBeLessThanOrEqual(state.reserve.maxFindingBatches)
    } finally {
      await fixture.close()
    }
  },
  30000,
)

it("refuses a larger room-aware default plan before consent under the unchanged attempt budget", async () => {
  const bytes = Buffer.from("Larger synthetic original passage. ".repeat(8000))
  const fixture = await persistedSource(bytes, await extract(bytes, "txt"), { draftOnly: true })
  try {
    const result = await exerciseNormalV4(fixture)
    await writeFile(
      join(directory, "larger-txt.json"),
      JSON.stringify({ ...result, semanticScores: "NOT RUN" }, null, 2),
      { flag: "wx", mode: 0o600 },
    )
    expect(result.kind).toBe("refused-before-consent")
    expect(result.jobs).toHaveLength(0)
    expect(result.native).toHaveLength(0)
    expect(fixture.storage.counts()).toMatchObject({ grants: 0, jobs: 0, attempts: 0 })
    expect(result.review).toMatchObject({
      preparation: { state: "blocked", reason: "attempt-budget-limit" },
    })
  } finally {
    await fixture.close()
  }
}, 30000)

it("keeps the normal approved batch ceiling fixed when60 rich findings need too many requests", async () => {
  const family = corpus.find((family) => family.id === "reversal")
  if (!family) throw new TypeError("Missing frozen family")
  const fixture = await persistedCorpus(family, "epub", { draftOnly: true })
  try {
    const result = await exerciseNormalV4(fixture, new BatchedRuntimeAdapter("not-addressed", 60))
    await writeFile(
      join(directory, "rich-batch-overflow.json"),
      JSON.stringify({ ...result, semanticScores: "NOT RUN" }, null, 2),
      { flag: "wx", mode: 0o600 },
    )
    expect(result.kind).toBe("processed")
    if (result.kind !== "processed") throw new TypeError("Rich fixture refused before generation")
    expect(result.analysis.status).toBe("partial")
    expect(
      result.analysis.wholeBook?.limitations.some((value) =>
        value.includes("batch-reserve-overflow"),
      ),
    ).toBe(true)
    expect(result.jobs).toHaveLength(2)
    expect(result.native).toHaveLength(2)
    expect(result.analysis.wholeBook?.batched?.reserve).toEqual(
      result.setup.batchedVerificationReserve,
    )
    expect(fixture.storage.sources.getSetup(result.setup.id)).toEqual(result.setup)
  } finally {
    await fixture.close()
  }
}, 30000)
