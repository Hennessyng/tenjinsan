import { AnalysisRevision } from "@reading-studio/contracts"
import { afterEach, expect, it } from "vitest"
import { questionReferenceContract } from "../src/question-reference-contract.ts"
import { questionIdentityFixture } from "./question-identity-fixture.ts"

const fixtures: ReturnType<typeof questionIdentityFixture>[] = []
afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.close()
})

it("permits distinct approved references and reuse across different lenses", () => {
  // Given
  const fixture = questionIdentityFixture()
  fixtures.push(fixture)
  const current = fixture.scope("multiple-references")
  const normalization = fixture.storage.sources.getNormalization(
    current.setup.analysis.normalizationRevisionId,
  )
  const span = current.analysis.claims[0]?.sources[0]
  if (!normalization || !span) throw new TypeError("Missing synthetic evidence")
  const second = {
    ...span,
    start: span.start + 1,
    originalFragment: span.originalFragment.slice(1),
  }
  const analysis = AnalysisRevision.parse({
    ...current.analysis,
    concepts: [
      { id: "second-synthetic-finding", text: "Another approved detail", sources: [second] },
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
      ({ revisionId: _revisionId, sources, complications, ...lens }, index) => ({
        ...lens,
        evidenceRefs:
          index === 0
            ? [contract.catalog.reference(span), contract.catalog.reference(second)]
            : sources.map(contract.catalog.reference),
        complications: complications.map(({ label, sources: refs }) => ({
          label,
          evidenceRefs: refs.map(contract.catalog.reference),
        })),
      }),
    ),
  }
  // When
  const parsed = contract.parse(wire)
  // Then
  expect(parsed.lenses[0]?.sources).toEqual([span, second])
  expect(parsed.lenses[1]?.sources).toEqual([span])
})
