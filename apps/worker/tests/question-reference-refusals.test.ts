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
  const current = fixture.scope("reference-refusals")
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
  const contract = questionReferenceContract(input)
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
  return { input, contract, wire }
}

it.each(["fenced", "multiple", "encoded"] as const)("never salvages %s output", (kind) => {
  // Given
  const { contract, wire } = given()
  const json = JSON.stringify(wire)
  const text =
    kind === "fenced"
      ? `\`\`\`json\n${json}\n\`\`\``
      : kind === "multiple"
        ? `${json}\n${json}`
        : JSON.stringify(json)
  // When / Then
  expect(() => contract.parseText(text)).toThrow()
})

it.each(["foreign-setup", "foreign-context", "changed-analysis"] as const)(
  "rejects stale references after %s even with the new root binding",
  (fault) => {
    // Given
    const { input, wire } = given()
    const changed =
      fault === "foreign-setup"
        ? { ...input, setup: { ...input.setup, id: "other-setup", studyId: "other-study" } }
        : fault === "foreign-context"
          ? { ...input, contextRevisionId: "other-context" }
          : {
              ...input,
              analysis: {
                ...input.analysis,
                claims: input.analysis.claims.map((finding) => ({
                  ...finding,
                  text: "Different synthetic approved finding",
                })),
              },
            }
    const foreign = questionReferenceContract(changed)
    // When / Then
    expect(foreign.schema.safeParse(wire).success).toBe(false)
    expect(foreign.schema.safeParse({ ...wire, binding: foreign.catalog.binding }).success).toBe(
      false,
    )
  },
)
