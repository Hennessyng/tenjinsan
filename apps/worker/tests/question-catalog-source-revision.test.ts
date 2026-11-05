import { afterEach, expect, it } from "vitest"
import { questionReferenceCatalog } from "../src/question-reference-catalog.ts"
import { questionIdentityFixture } from "./question-identity-fixture.ts"

const fixtures: ReturnType<typeof questionIdentityFixture>[] = []
afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.close()
})

it("rejects a foreign normalization revision for approved evidence", () => {
  // Given
  const fixture = questionIdentityFixture()
  fixtures.push(fixture)
  const current = fixture.scope("foreign-normalization")
  const normalization = fixture.storage.sources.getNormalization(
    current.setup.analysis.normalizationRevisionId,
  )
  if (!normalization) throw new TypeError("Missing synthetic normalization")
  const input = {
    setup: current.setup,
    analysis: current.analysis,
    normalization,
    contextRevisionId: current.input.context.revisionId,
  }
  expect(questionReferenceCatalog(input).citations.length).toBeGreaterThan(0)
  // When / Then
  expect(() =>
    questionReferenceCatalog({
      ...input,
      normalization: { ...normalization, id: "foreign-normalization" },
    }),
  ).toThrow("binding")
})
