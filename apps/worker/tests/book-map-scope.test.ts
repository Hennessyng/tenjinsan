import { rmSync } from "node:fs"
import { prepareBookMapScope } from "@reading-studio/generation"
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
