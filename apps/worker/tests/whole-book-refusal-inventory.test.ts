import { StudySetupRevision } from "@reading-studio/contracts"
import { wholeBookFeasibility } from "@reading-studio/generation"
import { afterEach, expect, it } from "vitest"
import { fixtureCapacity, wholeBookFixture } from "./whole-book-fixture.ts"

const fixtures: Awaited<ReturnType<typeof wholeBookFixture>>[] = []
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close()
})

it.each(["minimum", "allowance"] as const)(
  "refuses the %s bound without truncating the unsent inventory",
  async (bound) => {
    // Given
    const fixture = await wholeBookFixture("日本🧭".repeat(2000))
    fixtures.push(fixture)
    const original = fixture.storage.sources.getSetup("setup-whole")
    const normalization = fixture.storage.sources.getNormalization("normalization-1")
    if (!original || !normalization) throw new TypeError("Missing synthetic fixture")
    const capacity = {
      ...fixtureCapacity,
      id: `synthetic-adaptive-${bound}`,
      maxRequestBytes: bound === "minimum" ? 1 : 12_000,
    }
    const setup = StudySetupRevision.parse({
      ...original,
      analysis: {
        ...original.analysis,
        processing: { ...original.analysis.processing, capacityId: capacity.id, plan: undefined },
      },
    })
    // When
    const result = await wholeBookFeasibility({
      setup,
      normalization,
      capacity,
      cap: bound === "allowance" ? 20 : 64,
      used: 0,
    })
    // Then
    expect(result.kind).toBe("limited")
    if (result.kind !== "limited") throw new TypeError("Expected refusal")
    expect(result.failure.coverage.reason).toBe(
      bound === "minimum" ? "capacity-limit" : "attempt-budget-limit",
    )
    expect(
      result.failure.coverage.unsentRanges.reduce((sum, range) => sum + range.end - range.start, 0),
    ).toBe(
      normalization.resources
        .flatMap((resource) => (resource.status === "included" ? resource.blocks : []))
        .reduce((sum, block) => sum + block.text.length, 0),
    )
    expect(fixture.storage.counts()).toMatchObject({ jobs: 0, attempts: 0 })
  },
)
