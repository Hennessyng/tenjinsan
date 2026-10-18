import { rmSync } from "node:fs"
import { StudySetupRevision } from "@reading-studio/contracts"
import { bookMapRequest, bookMapRequestsFit, prepareBookMapScope } from "@reading-studio/generation"
import { ProviderAdapter } from "@reading-studio/providers"
import { afterEach, expect, it } from "vitest"
import { bookMapFixture } from "./book-map-fixture.ts"

const fixtures: ReturnType<typeof bookMapFixture>[] = []
afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    fixture.storage.close()
    rmSync(fixture.directory, { recursive: true, force: true })
  }
})

it.each([
  { blocks: 127, kind: "ready" },
  { blocks: 128, kind: "limited" },
])(
  "preserves the exact analysis window boundary for $blocks full-size blocks plus the final chapter",
  ({ blocks, kind }) => {
    // Given
    const fixture = bookMapFixture("x".repeat(12_000), blocks)
    fixtures.push(fixture)
    const setup = fixture.storage.sources.getSetup("setup-1")
    const normalization = fixture.storage.sources.getNormalization("normalization-1")
    if (!setup || !normalization) throw new TypeError("Missing source fixture")
    // When
    const result = prepareBookMapScope(setup, normalization)
    // Then
    expect(result.kind).toBe(kind)
    switch (result.kind) {
      case "ready":
        expect(result.windows).toHaveLength(128)
        break
      case "limited":
        expect(result.failure.coverage).toMatchObject({
          requiredWindows: 129,
          maxWindows: 128,
          transmission: "not-sent",
        })
        break
      default:
        assertNever(result)
    }
    expect(fixture.storage.counts()).toMatchObject({ jobs: 0, attempts: 0 })
  },
)
function assertNever(value: never): never {
  throw new TypeError(`Unexpected plan: ${value}`)
}

it.each(["x".repeat(9000), "あ".repeat(9000), "あ".repeat(12_000), "\\".repeat(12_000)])(
  "measures real ASCII/Japanese wire boundaries including escaped wrappers",
  async (text) => {
    // Given
    const fixture = bookMapFixture(text)
    fixtures.push(fixture)
    const original = fixture.storage.sources.getSetup("setup-1")
    const normalization = fixture.storage.sources.getNormalization("normalization-1")
    if (!original || !normalization) throw new TypeError("Missing source fixture")
    const setup = StudySetupRevision.parse({
      ...original,
      analysis: { ...original.analysis, provider: "anthropic", model: "claude-sonnet-4-6" },
    })
    const scope = prepareBookMapScope(setup, normalization)
    if (scope.kind !== "ready") throw new TypeError("Expected a ready window")
    const window = scope.windows[0]
    if (!window) throw new TypeError("Missing window")
    const request = bookMapRequest(setup, normalization, window)
    const adapter = new ProviderAdapter({ provider: "anthropic", apiKey: "synthetic-sizing-only" })
    const base = await adapter.measure(request)
    if (base > 32_000) {
      console.info(
        JSON.stringify({ source: text[0], sourceUnits: text.length, baseWireBytes: base }),
      )
      expect(await bookMapRequestsFit({ setup, normalization, windows: [window] })).toBe(false)
      return
    }
    const instruction = request.prompt.slice(0, request.prompt.indexOf("\n"))
    const boundary = instruction + "x".repeat(32_000 - base)
    const definition = {
      instruction: boundary,
      promptVersion: "analysis-1",
      schemaVersion: "analysis-1",
    }
    // When
    const measuredAtCap = await adapter.measure({
      ...request,
      prompt: boundary + request.prompt.slice(instruction.length),
    })
    const measuredOverCap = await adapter.measure({
      ...request,
      prompt: `${boundary}x${request.prompt.slice(instruction.length)}`,
    })
    const justUnder = await bookMapRequestsFit({
      setup,
      normalization,
      windows: [window],
      definition: { ...definition, instruction: boundary.slice(0, -1) },
    })
    const atCap = await bookMapRequestsFit({ setup, normalization, windows: [window], definition })
    const overCap = await bookMapRequestsFit({
      setup,
      normalization,
      windows: [window],
      definition: { ...definition, instruction: `${boundary}x` },
    })
    const escapedWrapper = await bookMapRequestsFit({
      setup,
      normalization,
      windows: [window],
      definition: { ...definition, instruction: "\\".repeat(32_000) },
    })
    // Then
    console.info(
      JSON.stringify({
        source: text[0],
        sourceUnits: text.length,
        baseWireBytes: base,
        atCapBytes: measuredAtCap,
        overCapBytes: measuredOverCap,
      }),
    )
    expect(atCap).toBe(true)
    expect(justUnder).toBe(true)
    expect(measuredAtCap).toBe(32_000)
    expect(measuredOverCap).toBe(32_001)
    expect(overCap).toBe(false)
    expect(escapedWrapper).toBe(false)
  },
)
