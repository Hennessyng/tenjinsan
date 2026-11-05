import { afterEach, expect, it } from "vitest"
import { questionReferenceCatalog } from "../src/question-reference-catalog.ts"
import { questionIdentityFixture } from "./question-identity-fixture.ts"

const fixtures: ReturnType<typeof questionIdentityFixture>[] = []
afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.close()
})

it("binds approved evidence to immutable source and context", () => {
  // Given
  const fixture = questionIdentityFixture()
  fixtures.push(fixture)
  const current = fixture.scope("reference-catalog")
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
  // When
  const catalog = questionReferenceCatalog(input)
  const first = catalog.citations[0]
  if (!first) throw new TypeError("Missing synthetic citation")
  // Then
  expect(catalog.resolve(first.id)).toEqual(first.span)
  expect(catalog.reference(first.span)).toBe(first.id)
  expect(Reflect.set(first, "span", { ...first.span, originalFragment: "changed" })).toBe(false)
  expect(Reflect.set(first.span, "originalFragment", "changed")).toBe(false)
  expect(
    questionReferenceCatalog({ ...input, contextRevisionId: "other-context" }).citations[0]?.id,
  ).not.toBe(first.id)
  expect(() => catalog.resolve("foreign-reference")).toThrow()
})

it.each(["source-hash", "quote-bytes", "range", "page-label"] as const)(
  "rejects inconsistent approved evidence: %s",
  (fault) => {
    // Given
    const fixture = questionIdentityFixture()
    fixtures.push(fixture)
    const current = fixture.scope("reference-refusal")
    const normalization = fixture.storage.sources.getNormalization(
      current.setup.analysis.normalizationRevisionId,
    )
    const finding = current.analysis.claims[0]
    if (!normalization || !finding) throw new TypeError("Missing synthetic evidence")
    const sources = finding.sources.map((span) => {
      switch (fault) {
        case "source-hash":
          return span
        case "quote-bytes":
          return { ...span, originalFragment: "different synthetic quote" }
        case "range":
          return { ...span, end: 99999 }
        case "page-label":
          return { ...span, pageLabel: "invented page" }
        default:
          throw new TypeError(`Unknown fault: ${fault satisfies never}`)
      }
    })
    const input = {
      setup: current.setup,
      analysis: { ...current.analysis, claims: [{ ...finding, sources }] },
      normalization:
        fault === "source-hash" ? { ...normalization, editionHash: "b".repeat(64) } : normalization,
      contextRevisionId: current.input.context.revisionId,
    }
    // When / Then
    expect(() => questionReferenceCatalog(input)).toThrow()
  },
)
