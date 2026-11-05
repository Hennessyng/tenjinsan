import { completeGraphFixtures } from "@reading-studio/storage/test-support"
import { expect, it } from "vitest"
import { analysisCacheKey, StudySetupRevision, TransmissionAuthorization } from "../src/index.ts"

const purpose = { version: "analysis-evaluation-1", terminal: "verified-analysis" }
it("accepts explicit analysis-only source identity without changing a missing-purpose legacy cache key", () => {
  const graph = completeGraphFixtures("openrouter")
  const before = analysisCacheKey(StudySetupRevision.parse(graph.setup).analysis)
  const parsed = StudySetupRevision.safeParse({
    ...graph.setup,
    analysis: { ...graph.setup.analysis, purpose },
  })
  expect(parsed.success).toBe(true)
  if (!parsed.success) throw new TypeError("Missing explicit purpose contract")
  expect(analysisCacheKey(parsed.data.analysis)).not.toBe(before)
  expect(analysisCacheKey(StudySetupRevision.parse(graph.setup).analysis)).toBe(before)
  expect(JSON.stringify(StudySetupRevision.parse(graph.setup))).not.toContain('"purpose"')
})
it("does not borrow an old grant or reader-context permission for the new terminal", () => {
  const graph = completeGraphFixtures("openrouter")
  const setup = { ...graph.setup, analysis: { ...graph.setup.analysis, purpose } }
  const authorize = (grant: unknown) =>
    TransmissionAuthorization.safeParse({
      setup,
      grant,
      installationId: graph.grant.installationId,
      ownerId: graph.grant.ownerId,
      categories: ["book-text", "derived-study-material"],
    })
  expect(
    authorize({
      ...graph.grant,
      purpose,
      id: `grant-${graph.setup.id}`,
      categories: ["book-text", "derived-study-material"],
    }).success,
  ).toBe(true)
  expect(authorize(graph.grant).success).toBe(false)
  expect(
    authorize({
      ...graph.grant,
      purpose,
      categories: ["book-text", "reader-context", "derived-study-material"],
    }).success,
  ).toBe(false)
})
