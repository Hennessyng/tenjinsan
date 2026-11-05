import { StudySetupRevision } from "@reading-studio/contracts"
import { bookMapRequest, wholeBookFeasibility } from "@reading-studio/generation"
import {
  legacyLocalReservationBytes as localRequestBytes,
  requestFitsCapacity,
} from "@reading-studio/providers"
import { afterEach, expect, it } from "vitest"
import { fixtureCapacity, wholeBookFixture } from "./whole-book-fixture.ts"

const fixtures: Awaited<ReturnType<typeof wholeBookFixture>>[] = []
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close()
})

it.each(["bytes", "tokens"] as const)(
  "re-packs mixed Unicode against the verified %s limit without dropping text",
  async (limit) => {
    // Given
    const text = '日本🧭語\\"'.repeat(900)
    const fixture = await wholeBookFixture(text)
    fixtures.push(fixture)
    const original = fixture.storage.sources.getSetup("setup-whole")
    const normalization = fixture.storage.sources.getNormalization("normalization-1")
    if (!original || !normalization) throw new TypeError("Missing synthetic fixture")
    const capacity = {
      ...fixtureCapacity,
      id: `synthetic-adaptive-${limit}`,
      maxRequestBytes: limit === "bytes" ? 12_000 : 32_000,
      contextTokens: limit === "tokens" ? 16_000 : fixtureCapacity.contextTokens,
    }
    const setup = StudySetupRevision.parse({
      ...original,
      analysis: {
        ...original.analysis,
        processing: { ...original.analysis.processing, capacityId: capacity.id, plan: undefined },
      },
    })
    // When
    const result = await wholeBookFeasibility({ setup, normalization, capacity, cap: 64, used: 0 })
    // Then
    if (result.kind !== "ready")
      throw new TypeError(`Unexpected refusal: ${result.failure.coverage.reason}`)
    expect(result.windows.length).toBeGreaterThan(1)
    const source = result.windows
      .flatMap((window) => window.ranges ?? [window])
      .filter((range) => range.blockId === "block-1")
    expect(source.map((range) => range.text).join("")).toBe(text)
    let cursor = 0
    for (const window of result.windows) {
      const request = bookMapRequest(setup, normalization, window)
      expect(
        requestFitsCapacity(request, localRequestBytes("chatgpt-subscription", request), capacity),
      ).toBe(true)
    }
    for (const range of source) {
      expect(range.start).toBe(cursor)
      expect(range.text).toBe(text.slice(range.start, range.end))
      expect(range.text.isWellFormed()).toBe(true)
      cursor = range.end
    }
    expect(cursor).toBe(text.length)
    expect(fixture.storage.counts()).toMatchObject({ jobs: 0, attempts: 0 })
  },
)
