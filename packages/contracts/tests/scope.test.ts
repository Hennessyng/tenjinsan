import { expect, it } from "vitest"
import { NormalizationRevision, NormalizedStudySetup, SourceScope } from "../src/index.ts"

const settings = {
  temperature: 0,
  topP: 1,
  maxOutputTokens: 6000,
  seed: null,
  reasoningEffort: "default",
}
const normalization = {
  id: "normalization-1",
  editionId: "edition-1",
  editionHash: "a".repeat(64),
  parserVersion: "1",
  normalizerVersion: "1",
  coverage: "complete",
  resources: [
    {
      path: "text/a.xhtml",
      role: "main-chapter",
      status: "included",
      blocks: [
        { id: "block-a", text: "Main A" },
        { id: "block-b", text: "Main B" },
      ],
    },
    {
      path: "text/b.xhtml",
      role: "main-chapter",
      status: "included",
      blocks: [{ id: "block-c", text: "Main C" }],
    },
    {
      path: "text/c.xhtml",
      role: "supplementary",
      status: "included",
      blocks: [{ id: "block-d", text: "Appendix" }],
    },
  ],
}
const allMain = [
  { resourcePath: "text/a.xhtml", blockIds: ["block-a", "block-b"] },
  { resourcePath: "text/b.xhtml", blockIds: ["block-c"] },
]
function input(scope: unknown) {
  return {
    normalization,
    setup: {
      id: "setup-1",
      studyId: "study-1",
      editionId: "edition-1",
      analysis: {
        editionHash: normalization.editionHash,
        normalizationRevisionId: normalization.id,
        scope,
        provider: "openai",
        model: "fixture",
        analysisPromptVersion: "1",
        analysisSchemaVersion: "1",
        settings,
      },
      generation: { promptVersion: "1", schemaVersion: "1", settings },
    },
  }
}
it("accepts the normalization fixture before testing joined scope", () => {
  const result = NormalizationRevision.safeParse(normalization)
  expect(result.success).toBe(true)
})
it.each([
  { selected: [{ resourcePath: "text/a.xhtml", blockIds: ["block-a"] }, allMain[1]] },
  { selected: [allMain[0]] },
])("rejects all-main scope when a main block or chapter is missing", ({ selected }) => {
  const given = input({ kind: "all-main-chapters", selected, exclusions: [] })
  const result = NormalizedStudySetup.safeParse(given)
  expect(result.success).toBe(false)
})
it("rejects all-main scope when content is explicitly excluded", () => {
  const given = input({
    kind: "all-main-chapters",
    selected: allMain,
    exclusions: [{ resourcePath: "text/c.xhtml", blockIds: ["block-d"] }],
  })
  const result = NormalizedStudySetup.safeParse(given)
  expect(result.success).toBe(false)
})
it("rejects exclusions directly when all-main scope is parsed", () => {
  const given = {
    kind: "all-main-chapters",
    selected: allMain,
    exclusions: [{ resourcePath: "text/c.xhtml", blockIds: ["block-d"] }],
  }
  const result = SourceScope.safeParse(given)
  expect(result.success).toBe(false)
})
it("accepts all-main scope when every main block is selected", () => {
  const result = NormalizedStudySetup.safeParse(
    input({ kind: "all-main-chapters", selected: allMain, exclusions: [] }),
  )
  expect(result.success).toBe(true)
})
it("accepts partial scope when an explicit bounded subset is selected", () => {
  const result = NormalizedStudySetup.safeParse(
    input({
      kind: "partial",
      selected: [{ resourcePath: "text/a.xhtml", blockIds: ["block-a"] }],
      exclusions: [{ resourcePath: "text/b.xhtml", blockIds: ["block-c"] }],
    }),
  )
  expect(result.success).toBe(true)
})
it("rejects stale normalization identity at the joined boundary", () => {
  const given = input({ kind: "partial", selected: allMain, exclusions: [] })
  const result = NormalizedStudySetup.safeParse({
    ...given,
    normalization: { ...normalization, id: "old-normalization" },
  })
  expect(result.success).toBe(false)
})
it("rejects nonexistent blocks in an explicitly partial scope", () => {
  const result = NormalizedStudySetup.safeParse(
    input({
      kind: "partial",
      selected: [{ resourcePath: "text/a.xhtml", blockIds: ["missing"] }],
      exclusions: [],
    }),
  )
  expect(result.success).toBe(false)
})

it("rejects all-main scope when a main resource was excluded during normalization", () => {
  const given = input({ kind: "all-main-chapters", selected: allMain, exclusions: [] })
  const result = NormalizedStudySetup.safeParse({
    ...given,
    normalization: {
      ...normalization,
      coverage: "partial",
      resources: [
        ...normalization.resources,
        {
          path: "text/unavailable.xhtml",
          role: "main-chapter",
          status: "excluded",
          reason: "Unsupported text",
        },
      ],
    },
  })
  expect(result.success).toBe(false)
})

it("rejects supplementary blocks mislabeled as all-main selection", () => {
  const given = input({
    kind: "all-main-chapters",
    selected: [...allMain, { resourcePath: "text/c.xhtml", blockIds: ["block-d"] }],
    exclusions: [],
  })
  const result = NormalizedStudySetup.safeParse(given)
  expect(result.success).toBe(false)
})

it("requires explicit main roles instead of inferring them from paths", () => {
  const given = input({ kind: "all-main-chapters", selected: allMain, exclusions: [] })
  const result = NormalizedStudySetup.safeParse({
    ...given,
    normalization: {
      ...normalization,
      resources: normalization.resources.map((resource) => ({
        ...resource,
        role: "supplementary",
      })),
    },
  })
  expect(result.success).toBe(false)
})

it("rejects missing source role rather than guessing a chapter classification", () => {
  const given = {
    ...normalization,
    resources: [
      {
        path: "chapter-1.xhtml",
        status: "included",
        blocks: [{ id: "block-1", text: "Synthetic" }],
      },
    ],
  }
  const result = NormalizationRevision.safeParse(given)
  expect(result.success).toBe(false)
})
