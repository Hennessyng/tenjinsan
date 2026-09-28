import { expect, expectTypeOf, it } from "vitest"
import type { z } from "zod"
import {
  AnalysisCacheInput,
  AnalysisQuestionSet,
  AnalysisRevision,
  BlockIdentityInput,
  EditionId,
  JobAuthorization,
  PrivacyScreenedProjection,
  PrivacyScreeningInput,
  PublicationProjection,
  PublicationRevision,
  privacyCanaryPaths,
  projectedStrings,
  projectionHash,
  requiredTeachingStates,
  SceneSpec,
  StudyAnalysis,
  type StudyId,
  stableBlockId,
} from "../src/index.ts"

const label = { en: "Synthetic explanation", ja: "説明" }
const hash = "a".repeat(64)
const cacheInput = {
  editionHash: hash,
  normalizationRevisionId: "normalization-1",
  scope: {
    kind: "partial",
    selected: [{ resourcePath: "ch1.xhtml", blockIds: ["block-1"] }],
    exclusions: [],
  },
  provider: "openai",
  model: "fixture",
  analysisPromptVersion: "1",
  analysisSchemaVersion: "1",
  settings: {
    temperature: 0,
    topP: 1,
    maxOutputTokens: 6000,
    seed: null,
    reasoningEffort: "default",
  },
}
const scene = {
  id: "scene-1",
  kind: "layered-diagram",
  title: label,
  layers: [{ id: "layer-1", label, explanation: label }],
  practice: [],
  captions: [{ stateId: "scene-1:layer:layer-1", text: label }],
}
const projection = {
  title: label,
  sections: [
    {
      id: "section-1",
      heading: label,
      content: label,
      sourceNotes: [],
      scenes: [scene],
      practice: [
        { id: "practice-1", prompt: label, options: [{ id: "option-1", label, feedback: label }] },
      ],
    },
  ],
  assets: [],
}

function approvedPublication() {
  const parsed = PublicationProjection.parse(projection)
  const digest = projectionHash(parsed)
  return {
    id: "publication-1",
    lessonRevisionId: "lesson-1",
    analysisRevisionId: "analysis-1",
    projection,
    projectionHash: digest,
    privacyReview: {
      id: "review-1",
      projectionHash: digest,
      reviewedPaths: projectedStrings(parsed).map((entry) => entry.path),
      findings: [],
      status: "passed",
    },
    approval: {
      projectionHash: digest,
      privacyReviewId: "review-1",
      evidenceReportHash: hash,
      rendererVersion: "1",
      requiredStateIds: ["scene-1:layer:layer-1", "section-1:practice:practice-1:option-1"],
      assetHashes: [],
      approvedAt: "2026-09-18T00:00:00Z",
    },
  }
}
it("keeps unrelated branded IDs nonassignable", () => {
  expectTypeOf<z.infer<typeof EditionId>>().not.toExtend<z.infer<typeof StudyId>>()
  expect(EditionId.safeParse("../private").success).toBe(false)
})
it("derives stable source identity independently of caller object order", () => {
  const input = BlockIdentityInput.parse({
    editionHash: hash,
    normalizerVersion: "1",
    resourcePath: "ch1.xhtml",
    blockIdentity: "paragraph-1",
  })
  const result = stableBlockId(input)
  expect(stableBlockId(BlockIdentityInput.parse({ ...input }))).toBe(result)
  expect(stableBlockId(BlockIdentityInput.parse({ ...input, normalizerVersion: "2" }))).not.toBe(
    result,
  )
})
it("accepts complete review bound to all projected fields and derived states", () => {
  const result = PublicationRevision.safeParse(approvedPublication())
  expect(result.success).toBe(true)
})
it.each(["caption", "feedback"])("rejects normalized private canary in %s", (location) => {
  const privateLabel = { en: "  PRIVATE  ＣＡＮＡＲＹ ", ja: "秘密" }
  const section = {
    ...projection.sections[0],
    scenes: [
      {
        ...scene,
        captions: [
          { stateId: "scene-1:layer:layer-1", text: location === "caption" ? privateLabel : label },
        ],
      },
    ],
    practice: [
      {
        id: "practice-1",
        prompt: label,
        options: [
          { id: "option-1", label, feedback: location === "feedback" ? privateLabel : label },
        ],
      },
    ],
  }
  const input = {
    projection: { ...projection, sections: [section] },
    privateDetails: ["private canary"],
  }
  const result = PrivacyScreenedProjection.safeParse(input)
  expect(result.success).toBe(false)
  const paths = privacyCanaryPaths(PrivacyScreeningInput.parse(input))
  expect(paths).toEqual([
    location === "caption"
      ? "/sections/0/scenes/0/captions/0/text/en"
      : "/sections/0/practice/0/options/0/feedback/en",
  ])
})
it("rejects content edits with stale publication approval", () => {
  const given = approvedPublication()
  const result = PublicationRevision.safeParse({
    ...given,
    projection: { ...projection, title: { en: "Changed", ja: "変更" } },
  })
  expect(result.success).toBe(false)
})
it("rejects omissions in review paths and forged state manifest", () => {
  const given = approvedPublication()
  expect(
    PublicationRevision.safeParse({
      ...given,
      privacyReview: {
        ...given.privacyReview,
        reviewedPaths: given.privacyReview.reviewedPaths.slice(1),
      },
    }).success,
  ).toBe(false)
  expect(
    PublicationRevision.safeParse({
      ...given,
      approval: { ...given.approval, requiredStateIds: [] },
    }).success,
  ).toBe(false)
})
it("ignores a forged model state list in the trusted derivation", () => {
  const trusted = SceneSpec.parse(scene)
  const result = requiredTeachingStates({ ...trusted, ...{ requiredTeachingStates: [] } })
  expect(result.map((state) => state.id)).toEqual(["scene-1:layer:layer-1"])
})
it("rejects a source span from another edition in analysis", async () => {
  const { analysisCacheKey } = await import("../src/index.ts")
  const input = AnalysisCacheInput.parse(cacheInput)
  const given = {
    id: "analysis-1",
    editionId: "edition-1",
    cacheInput,
    cacheKey: analysisCacheKey(input),
    status: "successful",
    chapters: [{ resourcePath: "ch1.xhtml", blockIds: ["block-1"], status: "complete" }],
    claims: [
      {
        id: "claim-1",
        text: "Synthetic",
        sources: [
          {
            editionId: "edition-2",
            normalizationRevisionId: "normalization-1",
            resourcePath: "ch1.xhtml",
            blockId: "block-1",
            start: 0,
            end: 4,
            originalFragment: "text",
          },
        ],
      },
    ],
    concepts: [],
    qualifications: [],
  }
  expect(AnalysisRevision.safeParse(given).success).toBe(false)
})
it("rejects setup and analysis provider drift at the joined boundary", async () => {
  const { analysisCacheKey } = await import("../src/index.ts")
  const input = AnalysisCacheInput.parse(cacheInput)
  const setup = {
    id: "setup-1",
    studyId: "study-1",
    editionId: "edition-1",
    analysis: { ...cacheInput, provider: "anthropic" },
    generation: { promptVersion: "1", schemaVersion: "1", settings: input.settings },
  }
  const analysis = {
    id: "analysis-1",
    editionId: "edition-1",
    cacheInput,
    cacheKey: analysisCacheKey(input),
    status: "successful",
    chapters: [{ resourcePath: "ch1.xhtml", blockIds: ["block-1"], status: "complete" }],
    claims: [],
    concepts: [],
    qualifications: [],
  }
  expect(StudyAnalysis.safeParse({ setup, analysis }).success).toBe(false)
  expect(
    StudyAnalysis.safeParse({ setup: { ...setup, analysis: cacheInput }, analysis }).success,
  ).toBe(true)
  expect(
    AnalysisQuestionSet.safeParse({
      analysis: { ...analysis, status: "partial" },
      questionSet: { analysisRevisionId: "analysis-1", questions: [] },
    }).success,
  ).toBe(false)
})
it("exports a joined job authorization boundary", () => {
  expect(JobAuthorization.safeParse({}).success).toBe(false)
})
