import { rmSync } from "node:fs"
import { StudySetupRevision } from "@reading-studio/contracts"
import { bookMapRequestsFit, prepareBookMapScope } from "@reading-studio/generation"
import { afterEach, expect, it } from "vitest"
import { bookMapFixture } from "./book-map-fixture.ts"

const fixtures: ReturnType<typeof bookMapFixture>[] = []
afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    fixture.storage.close()
    rmSync(fixture.directory, { recursive: true, force: true })
  }
})

it("refuses whole-book sizing when the exact route has no verified token capacity", async () => {
  // Given
  const fixture = bookMapFixture("A short synthetic source.")
  fixtures.push(fixture)
  const original = fixture.storage.sources.getSetup("setup-1")
  const normalization = fixture.storage.sources.getNormalization("normalization-1")
  if (!original || !normalization) throw new TypeError("Missing synthetic fixture")
  const setup = StudySetupRevision.parse({
    ...original,
    analysis: {
      ...original.analysis,
      scope: { ...original.analysis.scope, kind: "whole-document" },
      analysisPromptVersion: "whole-book-2",
      analysisSchemaVersion: "whole-book-2",
    },
  })
  const scope = prepareBookMapScope(setup, normalization)
  if (scope.kind !== "ready") throw new TypeError("Expected synthetic local plan")
  // When
  const fits = await bookMapRequestsFit({ setup, normalization, windows: scope.windows })
  // Then
  expect(fits).toBe(false)
  expect(fixture.storage.counts()).toMatchObject({ jobs: 0, attempts: 0 })
})
