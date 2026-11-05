import { BookMapPipeline } from "@reading-studio/generation"
import { afterEach, expect, it } from "vitest"
import { fixtureCapacity, wholeBookFixture } from "./whole-book-fixture.ts"

const fixtures: Awaited<ReturnType<typeof wholeBookFixture>>[] = []
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close()
})

it("refuses an injected definition for the compiled whole-book version", async () => {
  // Given
  const fixture = await wholeBookFixture()
  fixtures.push(fixture)
  const pipeline = new BookMapPipeline(
    {
      storage: fixture.storage,
      ownerId: "owner-1",
      installationId: "installation-1",
      capacity: fixtureCapacity,
      localSubscriptions: true,
    },
    {
      promptVersion: "whole-book-2",
      schemaVersion: "whole-book-2",
      instruction: "An unversioned changed instruction",
    },
  )
  // When / Then
  expect(() => pipeline.prepare("setup-whole", "grant-whole")).toThrow("unsupported-version")
  expect(fixture.storage.counts()).toMatchObject({ jobs: 0, attempts: 0 })
})
