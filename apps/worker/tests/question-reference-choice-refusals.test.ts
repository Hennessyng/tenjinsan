import { afterEach, expect, it } from "vitest"
import { questionReferenceContract } from "../src/question-reference-contract.ts"
import { questionIdentityFixture } from "./question-identity-fixture.ts"

const fixtures: ReturnType<typeof questionIdentityFixture>[] = []
afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.close()
})

it.each([
  "duplicate-reference",
  "choice-bounds",
  "duplicate-options",
  "unknown-group",
  "duplicate-lens",
] as const)("rejects invalid question wire: %s", (fault) => {
  // Given
  const fixture = questionIdentityFixture()
  fixtures.push(fixture)
  const current = fixture.scope("choice-refusals")
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
    ({ revisionId: _revisionId, sources, complications, ...lens }) => ({
      ...lens,
      evidenceRefs: sources.map(contract.catalog.reference),
      complications: complications.map(({ label, sources: refs }) => ({
        label,
        evidenceRefs: refs.map(contract.catalog.reference),
      })),
    }),
  )
  const first = lenses[0]
  const second = lenses[1]
  if (!first || !second || !first.options[0] || !second.options[0])
    throw new TypeError("Missing synthetic choices")
  switch (fault) {
    case "duplicate-reference":
      first.evidenceRefs = [...first.evidenceRefs, ...first.evidenceRefs]
      break
    case "choice-bounds":
      first.maxSelections = first.options.length + 1
      break
    case "duplicate-options":
      second.options = second.options.map((option, index) =>
        index === 0 ? { ...option, id: first.options[0]?.id ?? "missing" } : option,
      )
      break
    case "unknown-group":
      first.groupId = "foreign-group"
      break
    case "duplicate-lens":
      second.id = first.id
      break
    default:
      throw new TypeError(`Unknown fault: ${fault satisfies never}`)
  }
  // When / Then
  expect(
    contract.schema.safeParse({
      version: "question-evidence-refs-v1",
      binding: contract.catalog.binding,
      groups: current.draft.groups,
      lenses,
    }).success,
  ).toBe(false)
})
