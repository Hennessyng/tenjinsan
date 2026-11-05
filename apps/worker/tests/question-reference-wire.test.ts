import { afterEach, expect, it } from "vitest"
import { questionReferenceContract } from "../src/question-reference-contract.ts"
import { questionIdentityFixture } from "./question-identity-fixture.ts"

const fixtures: ReturnType<typeof questionIdentityFixture>[] = []
afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.close()
})

function given() {
  const fixture = questionIdentityFixture()
  fixtures.push(fixture)
  const current = fixture.scope("reference-wire")
  const normalization = fixture.storage.sources.getNormalization(
    current.setup.analysis.normalizationRevisionId,
  )
  if (!normalization) throw new TypeError("Missing synthetic normalization")
  const contract = questionReferenceContract({
    setup: current.setup,
    analysis: current.analysis,
    normalization,
    contextRevisionId: current.input.context.revisionId,
  })
  const wire = {
    version: "question-evidence-refs-v1",
    binding: contract.catalog.binding,
    groups: current.draft.groups,
    lenses: current.draft.lenses.map(
      ({ revisionId: _revisionId, sources, complications, ...lens }) => ({
        ...lens,
        evidenceRefs: sources.map(contract.catalog.reference),
        complications: complications.map(({ label, sources: refs }) => ({
          label,
          evidenceRefs: refs.map(contract.catalog.reference),
        })),
      }),
    ),
  }
  return { contract, wire, current }
}

it("hydrates only approved evidence and application-owned revision identities", () => {
  // Given
  const { contract, wire, current } = given()
  // When
  const result = contract.parse(wire)
  // Then
  expect(result.lenses.map((lens) => lens.sources)).toEqual(
    current.draft.lenses.map((lens) => lens.sources),
  )
  expect(new Set(result.lenses.map((lens) => lens.revisionId)).size).toBe(result.lenses.length)
  expect(contract.parseText(JSON.stringify(wire))).toEqual(result)
})

it.each(["unknown-reference", "wrong-binding", "legacy-revision", "legacy-sources"] as const)(
  "rejects %s instead of accepting provider-authored evidence",
  (fault) => {
    // Given
    const { contract, wire } = given()
    const first = wire.lenses[0]
    if (!first) throw new TypeError("Missing synthetic lens")
    const changed = {
      ...wire,
      binding: fault === "wrong-binding" ? "foreign" : wire.binding,
      lenses: [
        {
          ...first,
          ...(fault === "unknown-reference" ? { evidenceRefs: ["foreign"] } : {}),
          ...(fault === "legacy-revision" ? { revisionId: "provider-authored" } : {}),
          ...(fault === "legacy-sources" ? { sources: [] } : {}),
        },
        ...wire.lenses.slice(1),
      ],
    }
    // When / Then
    expect(() => contract.parse(changed)).toThrow()
  },
)
