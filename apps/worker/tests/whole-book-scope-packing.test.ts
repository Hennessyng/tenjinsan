import { rmSync } from "node:fs"
import { StudySetupRevision } from "@reading-studio/contracts"
import { prepareBookMapScope } from "@reading-studio/generation"
import { afterEach, expect, it } from "vitest"
import { z } from "zod"
import { bookMapFixture } from "./book-map-fixture.ts"

const fixtures: ReturnType<typeof bookMapFixture>[] = []
afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    fixture.storage.close()
    rmSync(fixture.directory, { recursive: true, force: true })
  }
})

function source(text: string, count = 1) {
  const fixture = bookMapFixture(text, count)
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
  return { fixture, setup, normalization }
}
const Packed = z.object({
  ranges: z.array(
    z.object({ resourcePath: z.string(), start: z.number(), end: z.number(), text: z.string() }),
  ),
})

it("packs adjacent short paragraphs without one call per paragraph", () => {
  // Given
  const input = source("短い段落。", 200)
  // When
  const result = prepareBookMapScope(input.setup, input.normalization)
  // Then
  if (result.kind !== "ready") throw new TypeError("Expected packed plan")
  expect(result.windows.length).toBeLessThanOrEqual(2)
  expect(
    z
      .array(Packed)
      .parse(result.windows)
      .flatMap((part) => part.ranges),
  ).toHaveLength(201)
  expect(input.fixture.storage.counts()).toMatchObject({ jobs: 0, attempts: 0 })
})

it("splits mixed Unicode without changing or splitting a surrogate pair", () => {
  // Given
  const text = `${"日".repeat(11999)}🧭${'a\\"'.repeat(9000)}`
  const input = source(text)
  // When
  const result = prepareBookMapScope(input.setup, input.normalization)
  // Then
  if (result.kind !== "ready") throw new TypeError("Expected split plan")
  const parts = z
    .array(Packed)
    .parse(result.windows)
    .flatMap((part) => part.ranges)
    .filter((range) => range.resourcePath === "text/chapter.xhtml")
  expect(parts.length).toBeGreaterThan(1)
  expect(parts.map((part) => part.text).join("")).toBe(text)
  let cursor = 0
  for (const part of parts) {
    expect(part.start).toBe(cursor)
    expect(part.text).toBe(text.slice(part.start, part.end))
    expect(part.text.isWellFormed()).toBe(true)
    cursor = part.end
  }
  expect(cursor).toBe(text.length)
})
