import { wholeBookFeasibility } from "@reading-studio/generation"
import { afterEach, expect, it } from "vitest"
import { fixtureCapacity, wholeBookFixture } from "./whole-book-fixture.ts"

const fixtures: Awaited<ReturnType<typeof wholeBookFixture>>[] = []
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close()
})

it.each([NaN, Infinity, -1, 100_000])(
  "refuses invalid or excessive verified input-token measurements (%s)",
  async (tokens) => {
    // Given
    const fixture = await wholeBookFixture()
    fixtures.push(fixture)
    const setup = fixture.storage.sources.getSetup("setup-whole")
    const normalization = fixture.storage.sources.getNormalization("normalization-1")
    if (!setup || !normalization) throw new TypeError("Missing synthetic fixture")
    // When
    const result = await wholeBookFeasibility({
      setup,
      normalization,
      capacity: { ...fixtureCapacity, countInputTokens: () => tokens },
      cap: 64,
      used: 0,
    })
    // Then
    expect(result.kind).toBe("limited")
    if (result.kind !== "limited") throw new TypeError("Expected capacity refusal")
    expect(result.failure.coverage.reason).toBe("capacity-limit")
    expect(fixture.storage.counts()).toMatchObject({ jobs: 0, attempts: 0 })
  },
)
