import { StudySetupRevision } from "@reading-studio/contracts"
import { wholeBookFeasibility } from "@reading-studio/generation"
import { afterEach, expect, it } from "vitest"
import { fixtureCapacity, wholeBookFixture } from "./whole-book-fixture.ts"

const fixtures: Awaited<ReturnType<typeof wholeBookFixture>>[] = []
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close()
})

async function input() {
  const fixture = await wholeBookFixture()
  fixtures.push(fixture)
  const setup = fixture.storage.sources.getSetup("setup-whole")
  const normalization = fixture.storage.sources.getNormalization("normalization-1")
  if (!setup || !normalization) throw new TypeError("Missing synthetic fixture")
  return { setup, normalization, capacity: fixtureCapacity, cap: 64, used: 0 }
}

it("refuses an unsupported synthesis version before granting", async () => {
  // Given
  const source = await input()
  const setup = StudySetupRevision.parse({
    ...source.setup,
    analysis: {
      ...source.setup.analysis,
      processing: { ...source.setup.analysis.processing, synthesisVersion: "unsupported" },
    },
  })
  // When
  const result = await wholeBookFeasibility({ ...source, setup })
  // Then
  expect(result.kind).toBe("limited")
  if (result.kind !== "limited") throw new TypeError("Expected refusal")
  expect(result.failure.coverage.reason).toBe("unsupported-version")
})

it.each([
  { cap: 20, used: 0, kind: "ready" },
  { cap: 20, used: 1, kind: "limited" },
  { cap: 24, used: 5, kind: "limited" },
  { cap: 64, used: 45, kind: "limited" },
])("counts bounded work under $cap with $used used", async ({ cap, used, kind }) => {
  // Given
  const source = await input()
  // When
  const result = await wholeBookFeasibility({ ...source, cap, used })
  // Then
  expect(result.kind).toBe(kind)
  if (result.kind === "limited")
    expect(result.failure.coverage).toMatchObject({
      reason: "attempt-budget-limit",
      allowance: { cap, used, plannedAttempts: 20 },
    })
})
