import { AnalysisRevision } from "@reading-studio/contracts"
import { afterEach, expect, it } from "vitest"
import { questionReferenceContract } from "../src/question-reference-contract.ts"
import { questionIdentityFixture } from "./question-identity-fixture.ts"

const fixtures: ReturnType<typeof questionIdentityFixture>[] = []
afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.close()
})

it("retains approved qualifications while hydrating stable application identities", () => {
  // Given
  const fixture = questionIdentityFixture()
  fixtures.push(fixture)
  const current = fixture.scope("reference-qualification")
  const normalization = fixture.storage.sources.getNormalization(
    current.setup.analysis.normalizationRevisionId,
  )
  const claim = current.analysis.claims[0]
  if (!normalization || !claim) throw new TypeError("Missing synthetic evidence")
  const analysis = AnalysisRevision.parse({
    ...current.analysis,
    qualifications: [
      { id: "synthetic-qualification", text: "Synthetic limit", sources: claim.sources },
    ],
  })
  const contract = questionReferenceContract({
    setup: current.setup,
    analysis,
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
  const before = JSON.stringify(wire)
  // When
  const draft = contract.parse(wire)
  // Then
  expect(
    contract.catalog.findings.filter((item) => item.category === "qualification"),
  ).toHaveLength(1)
  expect(draft.lenses.map((lens) => lens.complications)).toEqual(
    current.draft.lenses.map((lens) => lens.complications),
  )
  expect(contract.parse(wire)).toEqual(draft)
  expect(JSON.stringify(wire)).toBe(before)
})
