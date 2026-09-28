import { rmSync } from "node:fs"
import { bookMapDefinition } from "@reading-studio/generation"
import { afterEach, expect, it } from "vitest"
import { bookMapFixture, FixtureAdapter, fixtureWorker } from "./book-map-fixture.ts"

const fixtures: ReturnType<typeof bookMapFixture>[] = []
afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    fixture.storage.close()
    rmSync(fixture.directory, { recursive: true, force: true })
  }
})

for (const change of ["prompt", "schema", "settings"] as const) {
  it(`creates a fresh immutable revision when the approved ${change} changes`, async () => {
    // Given
    const fixture = bookMapFixture()
    fixtures.push(fixture)
    const adapter = new FixtureAdapter()
    const original = fixtureWorker(fixture.storage, adapter)
    original.pipeline.prepare("setup-1", "grant-1")
    while ((await original.worker.runNext()).kind !== "idle") {}
    const before = original.pipeline.prepare("setup-1", "grant-1")
    const setup = fixture.storage.sources.getSetup("setup-1")
    const grant = fixture.storage.sources.getGrant("grant-1")
    if (!setup || !grant) throw new TypeError("Missing fixture setup")
    const definition = {
      ...bookMapDefinition,
      promptVersion: change === "prompt" ? "analysis-2" : "analysis-1",
      schemaVersion: change === "schema" ? "analysis-2" : "analysis-1",
    }
    fixture.storage.sources.appendSetup({
      record: {
        ...setup,
        id: "setup-2",
        analysis: {
          ...setup.analysis,
          analysisPromptVersion: definition.promptVersion,
          analysisSchemaVersion: definition.schemaVersion,
          settings: {
            ...setup.analysis.settings,
            maxOutputTokens: change === "settings" ? 500 : setup.analysis.settings.maxOutputTokens,
          },
        },
      },
      parentRevisionId: setup.id,
    })
    fixture.storage.sources.appendGrant({ ...grant, id: "grant-2", setupRevisionId: "setup-2" })
    const revised = fixtureWorker(fixture.storage, adapter, definition)
    // When
    const pending = revised.pipeline.prepare("setup-2", "grant-2")
    while ((await revised.worker.runNext()).kind !== "idle") {}
    const after = revised.pipeline.prepare("setup-2", "grant-2")
    // Then
    expect(pending.status).toBe("partial")
    expect(after.status).toBe("successful")
    expect(after.id).not.toBe(before.id)
    expect(after.cacheKey).not.toBe(before.cacheKey)
    expect(adapter.requests).toHaveLength(4)
    expect(fixture.storage.workflow.getAnalysis(before.id)).toEqual(before)
  })
}
