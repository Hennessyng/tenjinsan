import { afterEach, expect, it } from "vitest"
import { questionReferenceContract } from "../src/question-reference-contract.ts"
import { questionIdentityFixture } from "./question-identity-fixture.ts"

const fixtures: ReturnType<typeof questionIdentityFixture>[] = []
afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.close()
})

it.each(["legacy-complication", "wrong-version"] as const)(
  "rejects %s without accepting an alternate text-bearing path",
  (fault) => {
    // Given
    const fixture = questionIdentityFixture()
    fixtures.push(fixture)
    const current = fixture.scope("legacy-fields")
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
    const lenses = current.draft.lenses.map(
      ({ revisionId: _revisionId, sources, complications, ...lens }, index) => ({
        ...lens,
        evidenceRefs: sources.map(contract.catalog.reference),
        complications:
          fault === "legacy-complication" && index === 0
            ? complications
            : complications.map(({ label, sources: refs }) => ({
                label,
                evidenceRefs: refs.map(contract.catalog.reference),
              })),
      }),
    )
    const wire = {
      version:
        fault === "wrong-version" ? "question-evidence-refs-v0" : "question-evidence-refs-v1",
      binding: contract.catalog.binding,
      groups: current.draft.groups,
      lenses,
    }
    // When / Then
    expect(contract.schema.safeParse(wire).success).toBe(false)
    expect(() => contract.parse(wire)).toThrow()
  },
)
