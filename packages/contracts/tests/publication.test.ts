import { expect, it } from "vitest"
import {
  LessonAttribution,
  PrivacyReview,
  PublicationProjection,
  PublicationRevision,
  projectionHash,
} from "../src/index.ts"

export const bilingual = { en: "An original example", ja: "独自の例" }
export const projection = {
  title: bilingual,
  sections: [
    {
      id: "section-1",
      heading: bilingual,
      content: bilingual,
      sourceNotes: [],
      scenes: [],
      practice: [],
    },
  ],
  assets: [],
}
it("accepts allowlisted bilingual publication copy", () => {
  const result = PublicationProjection.parse(projection)
  expect(result.sections[0]?.heading).toEqual(bilingual)
})
it.each(["rawContext", "ownerId", "account", "modelResponse", "sourceBlocks", "apiKey"])(
  "rejects private projection field %s",
  (field) => {
    const result = PublicationProjection.safeParse({ ...projection, [field]: "PRIVATE_CANARY" })
    expect(result.success).toBe(false)
  },
)
it("binds privacy reports to content hashes and all string paths", () => {
  const parsed = PublicationProjection.parse(projection)
  const result = PublicationRevision.safeParse({
    id: "publication-1",
    lessonRevisionId: "lesson-1",
    analysisRevisionId: "analysis-1",
    projection,
    projectionHash: projectionHash(parsed),
    privacyReview: {
      id: "privacy-1",
      projectionHash: "b".repeat(64),
      reviewedPaths: [],
      findings: [],
      status: "passed",
    },
    approval: {
      projectionHash: projectionHash(parsed),
      privacyReviewId: "privacy-1",
      evidenceReportHash: "c".repeat(64),
      rendererVersion: "1",
      requiredStateIds: [],
      assetHashes: [],
      approvedAt: "2026-09-18T00:00:00Z",
    },
  })
  expect(result.success).toBe(false)
})
it.each([
  "/sections/0/scenes/0/captions/0/text/en",
  "/sections/0/practice/0/options/0/feedback/ja",
])("rejects passed privacy report when canary is flagged at %s", (path) => {
  const result = PrivacyReview.safeParse({
    id: "privacy-1",
    projectionHash: "a".repeat(64),
    reviewedPaths: [path],
    findings: [{ path, category: "personal-detail", resolution: "unresolved" }],
    status: "passed",
  })
  expect(result.success).toBe(false)
})
it.each([
  { kind: "author-claim", sources: [] },
  { kind: "interpretation", sources: [] },
  { kind: "original-example", sources: [], authorVerified: true },
])("rejects invalid attribution", (given) => {
  const result = LessonAttribution.safeParse(given)
  expect(result.success).toBe(false)
})
