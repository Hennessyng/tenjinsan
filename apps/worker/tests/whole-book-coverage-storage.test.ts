import {
  type AnalysisRevision,
  analysisCacheKey,
  CoverageVerification,
  contentDigest,
} from "@reading-studio/contracts"
import { openStorage } from "@reading-studio/storage"
import { afterEach, expect, it } from "vitest"
import { closeBookRoute } from "./book-map-route-fixture.ts"
import { coverageFixture, finishCoverage } from "./whole-book-coverage-fixture.ts"

const fixtures: Awaited<ReturnType<typeof coverageFixture>>[] = []
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close()
})
async function prepared() {
  const fixture = await coverageFixture()
  fixtures.push(fixture)
  const { analysis } = await finishCoverage(fixture)
  if (!analysis.wholeBook) throw new TypeError("Missing preparation")
  return { fixture, analysis, data: analysis.wholeBook }
}
function changeCoverage(
  analysis: AnalysisRevision,
  change: (coverage: CoverageVerification) => CoverageVerification,
) {
  const data = analysis.wholeBook
  if (!data) throw new TypeError("Missing preparation")
  return {
    ...analysis,
    id: "forged-coverage",
    wholeBook: {
      ...data,
      verification: data.verification.map((check) => {
        if (!check.coverage) throw new TypeError("Missing coverage binding")
        const coverage = change(check.coverage)
        return {
          ...check,
          targetHash: coverage.targetHash,
          decisions: coverage.output.decisions,
          coverage,
        }
      }),
    },
  }
}

it.each(["fragment", "normalization"] as const)(
  "rejects rehashed verification with substituted original %s",
  async (kind) => {
    // Given
    const { fixture, analysis } = await prepared()
    const forged = changeCoverage(analysis, (coverage) => {
      const target = coverage.target
      if (target.kind !== "window") return coverage
      const changed = {
        ...target,
        originals: target.originals.map((span) =>
          kind === "fragment"
            ? {
                ...span,
                originalFragment: span.originalFragment.replace("Late exception", "Late amendment"),
              }
            : { ...span, normalizationRevisionId: "foreign-normalization" },
        ),
      }
      return CoverageVerification.parse({
        ...coverage,
        target: changed,
        targetHash: contentDigest(JSON.stringify(changed)),
      })
    })
    // When / Then
    expect(() =>
      fixture.storage.workflow.appendAnalysis({ record: forged, parentRevisionId: null }),
    ).toThrow()
  },
)

it("rejects a preparation partition that differs from its exact approved cached plan", async () => {
  // Given
  const { fixture, analysis } = await prepared()
  const processing = analysis.cacheInput.processing
  if (!processing?.plan) throw new TypeError("Missing approved plan")
  const cacheInput = {
    ...analysis.cacheInput,
    processing: {
      ...processing,
      plan: processing.plan.map((part) => ({ ...part, groupId: "foreign-group" })),
    },
  }
  // When / Then
  expect(() =>
    fixture.storage.workflow.appendAnalysis({
      record: {
        ...analysis,
        id: "forged-plan",
        cacheInput,
        cacheKey: analysisCacheKey(cacheInput),
      },
      parentRevisionId: null,
    }),
  ).toThrow()
})

it.each(["missing", "missing-global", "duplicate"] as const)(
  "rejects successful preparation with a %s required check",
  async (kind) => {
    // Given
    const { fixture, analysis, data } = await prepared()
    const first = data.verification[0]
    if (!first) throw new TypeError("Missing check")
    const verification =
      kind === "missing"
        ? data.verification.slice(1)
        : kind === "missing-global"
          ? data.verification.slice(0, -1)
          : [first, first, ...data.verification.slice(2)]
    // When / Then
    expect(() =>
      fixture.storage.workflow.appendAnalysis({
        record: { ...analysis, id: "forged-checks", wholeBook: { ...data, verification } },
        parentRevisionId: null,
      }),
    ).toThrow()
  },
)

it.each(["map", "synthesis"] as const)(
  "rejects a rehashed target with substituted %s findings",
  async (kind) => {
    // Given
    const { fixture, analysis } = await prepared()
    const forged = changeCoverage(analysis, (coverage) => {
      const target = coverage.target
      if (target.kind !== "window") return coverage
      const changed =
        kind === "map"
          ? {
              ...target,
              map: { ...target.map, summary: { ...target.map.summary, text: "Substituted map." } },
            }
          : {
              ...target,
              synthesis: {
                ...target.synthesis,
                thesis: target.synthesis.thesis.map((finding) => ({
                  ...finding,
                  text: "Substituted synthesis.",
                })),
              },
            }
      return CoverageVerification.parse({
        ...coverage,
        target: changed,
        targetHash: contentDigest(JSON.stringify(changed)),
      })
    })
    // When / Then
    expect(() =>
      fixture.storage.workflow.appendAnalysis({ record: forged, parentRevisionId: null }),
    ).toThrow()
  },
)

it("reads the exact completed verification after restart without new native calls", async () => {
  // Given
  const { fixture, analysis } = await prepared()
  await closeBookRoute(fixture.storage)
  fixture.storage.close()
  fixture.storage = openStorage(fixture)
  // When
  const read = fixture.storage.workflow.getAnalysis(analysis.id)
  const cached = fixture.storage.workflow.findSuccessfulAnalysis(analysis.cacheKey)
  // Then
  expect(read).toEqual(analysis)
  expect(cached).toEqual(analysis)
  expect(
    fixture.storage.execution
      .listSetupJobs("setup-coverage")
      .every((job) => job.state === "completed"),
  ).toBe(true)
})
