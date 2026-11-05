import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import {
  COVERAGE_VERIFICATION_VERSION,
  EXPERIMENTAL_COVERAGE_OPT_IN_VERSION,
  StudySetupRevision,
} from "@reading-studio/contracts"
import { wholeBookFeasibility } from "@reading-studio/generation"
import { expect, it } from "vitest"
import { bookFixtureCapacity } from "../../apps/worker/tests/book-map-route-fixture.ts"
import { coverageCapacityWitness } from "../../apps/worker/tests/whole-book-capacity-witness.ts"
import { corpus, extract, formats } from "./ten29/corpus-support.ts"
import { evidenceDirectory } from "./ten29/evidence.ts"
import { persistedCorpus } from "./ten29/persisted-corpus.ts"
import { persistedSource } from "./ten29/persisted-source.ts"

const directory = await evidenceDirectory("capacity-default-bound")
const cases = corpus.flatMap((family) => formats.map((format) => ({ family, format })))
async function check(fixture: Awaited<ReturnType<typeof persistedSource>>, id: string) {
  try {
    const draft = StudySetupRevision.parse({
      ...fixture.setup,
      analysis: {
        ...fixture.setup.analysis,
        processing: {
          ...fixture.setup.analysis.processing,
          synthesisVersion: COVERAGE_VERIFICATION_VERSION,
        },
      },
    })
    // Given: the plan came from the default adaptive planner, before any grant.
    const witness = coverageCapacityWitness({
      setup: draft,
      normalization: fixture.normalization,
      capacity: bookFixtureCapacity,
    })
    // When
    const result = await wholeBookFeasibility({
      setup: draft,
      normalization: fixture.normalization,
      capacity: bookFixtureCapacity,
      cap: 64,
      used: 0,
    })
    const markedDraft = StudySetupRevision.parse({
      ...draft,
      id: "explicit-experimental-draft",
      experimentalCoverageOptIn: { version: EXPERIMENTAL_COVERAGE_OPT_IN_VERSION, enabled: true },
    })
    const optIn = await wholeBookFeasibility({
      setup: markedDraft,
      normalization: fixture.normalization,
      capacity: bookFixtureCapacity,
      cap: 64,
      used: 0,
      allowExperimentalCoverage: true,
    })
    // Then
    expect(witness.mapFindings).toBe(10)
    expect(witness.synthesisFindings).toBe(10)
    expect(witness.transport.maxItemTextBytes).toBeLessThanOrEqual(128000)
    expect(witness.transport.maxRpcLineUnits).toBeLessThanOrEqual(1_000_000)
    expect(witness.measuredRequestBytes).toBeGreaterThan(32000)
    expect(witness.minimumOriginalRequestBytes).toBeGreaterThan(32000)
    expect(witness.schemaBytes).toBeGreaterThan(0)
    expect(witness.outputTokenByteBound).toBe("UNPROVEN")
    expect(result.kind).toBe("limited")
    if (result.kind === "limited")
      expect(result.failure.coverage).toMatchObject({
        reason: "capacity-limit",
        transmission: "not-sent",
      })
    expect(optIn).toMatchObject({
      kind: "ready",
      verificationCapacity: "unproven-experimental-opt-in",
    })
    expect(fixture.storage.counts()).toMatchObject({ grants: 0, jobs: 0, attempts: 0 })
    await writeFile(
      join(directory, `${id}.json`),
      JSON.stringify(
        {
          id,
          result,
          witness,
          counts: fixture.storage.counts(),
          policy: "v2 normal default; v3 only explicit unproven experimental opt-in",
          tokenCapCompatibility:
            "NOT CLAIMED; schema-valid bounds are not a certified output-token/UTF8 relationship",
        },
        null,
        2,
      ),
      { mode: 0o600, flag: "wx" },
    )
  } finally {
    await fixture.close()
  }
}

it.each(cases)(
  "uses default planner and refuses unproven v3 before granting for $family.id/$format with transport-bounded rich fake outputs",
  async ({ family, format }) => {
    await check(
      await persistedCorpus(family, format, { draftOnly: true }),
      `${family.id}-${format}`,
    )
  },
  30000,
)

it("refuses a larger synthetic default-planned source before granting, without inventing output-byte reservations", async () => {
  const bytes = Buffer.from("Larger synthetic original passage. ".repeat(1600))
  const extracted = await extract(bytes, "txt")
  await check(await persistedSource(bytes, extracted, { draftOnly: true }), "larger-txt")
}, 30000)
