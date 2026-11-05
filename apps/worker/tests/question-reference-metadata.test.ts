import { AnalysisRevision } from "@reading-studio/contracts"
import { afterEach, expect, it } from "vitest"
import { questionReferenceContract } from "../src/question-reference-contract.ts"
import { questionIdentityFixture } from "./question-identity-fixture.ts"

const fixtures: ReturnType<typeof questionIdentityFixture>[] = []
afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.close()
})

it("restores page metadata only from approved evidence, not the provider wire", () => {
  // Given
  const fixture = questionIdentityFixture()
  fixtures.push(fixture)
  const current = fixture.scope("reference-page")
  const stored = fixture.storage.sources.getNormalization(
    current.setup.analysis.normalizationRevisionId,
  )
  if (!stored) throw new TypeError("Missing synthetic normalization")
  const page = "Synthetic page label"
  const addPage = (item: (typeof current.analysis.claims)[number]) => ({
    ...item,
    sources: item.sources.map((span) => ({ ...span, pageLabel: page })),
  })
  const analysis = AnalysisRevision.parse({
    ...current.analysis,
    claims: current.analysis.claims.map(addPage),
    concepts: current.analysis.concepts.map(addPage),
    qualifications: current.analysis.qualifications.map(addPage),
  })
  const normalization = {
    ...stored,
    resources: stored.resources.map((resource) =>
      resource.status === "included"
        ? { ...resource, blocks: resource.blocks.map((block) => ({ ...block, pageLabel: page })) }
        : resource,
    ),
  }
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
        evidenceRefs: sources.map((span) =>
          contract.catalog.reference({ ...span, pageLabel: page }),
        ),
        complications: complications.map(({ label, sources: refs }) => ({
          label,
          evidenceRefs: refs.map((span) =>
            contract.catalog.reference({ ...span, pageLabel: page }),
          ),
        })),
      }),
    ),
  }
  // When
  const resolved = contract.parse(wire)
  // Then
  expect(
    resolved.lenses.every((lens) => lens.sources.every((span) => span.pageLabel === page)),
  ).toBe(true)
  expect(JSON.stringify(wire)).not.toContain(page)
  expect(JSON.stringify(wire)).not.toContain("originalFragment")
})
