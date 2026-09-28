import { expect, it } from "vitest"
import {
  AnalysisCacheInput,
  AnalysisRevision,
  analysisCacheKey,
  BookEdition,
  NormalizationRevision,
  SourceSpan,
  StudySetupRevision,
  TransmissionAuthorization,
} from "../src/index.ts"

export const hash = "a".repeat(64)
export const cacheInput = {
  editionHash: hash,
  normalizationRevisionId: "normalization-1",
  scope: {
    kind: "partial",
    selected: [{ resourcePath: "text/ch1.xhtml", blockIds: ["block-1"] }],
    exclusions: [{ resourcePath: "text/ch2.xhtml", blockIds: ["block-2"] }],
  },
  provider: "openai",
  model: "fixture-model",
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
export const setup = {
  id: "setup-1",
  studyId: "study-1",
  editionId: "edition-1",
  analysis: cacheInput,
  generation: { promptVersion: "1", schemaVersion: "1", settings: cacheInput.settings },
}
it("changes exact cache identity when any analysis-affecting input changes", () => {
  const given = AnalysisCacheInput.parse(cacheInput)
  const key = analysisCacheKey(given)
  for (const patch of [
    { model: "other" },
    { provider: "anthropic" },
    { analysisPromptVersion: "2" },
    { analysisSchemaVersion: "2" },
    { normalizationRevisionId: "normalization-2" },
    { editionHash: "b".repeat(64) },
    { settings: { ...cacheInput.settings, temperature: 1 } },
    { scope: { ...cacheInput.scope, exclusions: [] } },
  ]) {
    expect(analysisCacheKey(AnalysisCacheInput.parse({ ...cacheInput, ...patch }))).not.toBe(key)
  }
  expect(
    analysisCacheKey(
      AnalysisCacheInput.parse({ ...cacheInput, settings: { ...cacheInput.settings } }),
    ),
  ).toBe(key)
})
it("keeps analysis key unchanged when only generation configuration changes", () => {
  const given = StudySetupRevision.parse(setup)
  const changed = StudySetupRevision.parse({
    ...setup,
    generation: { ...setup.generation, promptVersion: "2" },
  })
  expect(analysisCacheKey(changed.analysis)).toBe(analysisCacheKey(given.analysis))
  expect(Object.isFrozen(given.analysis.settings)).toBe(true)
})
it.each([
  {
    ...cacheInput,
    scope: {
      ...cacheInput.scope,
      selected: [...cacheInput.scope.selected, ...cacheInput.scope.selected],
    },
  },
  { ...cacheInput, scope: { ...cacheInput.scope, exclusions: cacheInput.scope.selected } },
  { ...cacheInput, settings: { ...cacheInput.settings, apiKey: "canary" } },
])("rejects ambiguous scope and unapproved settings", (given) => {
  const result = AnalysisCacheInput.safeParse(given)
  expect(result.success).toBe(false)
})
it("rejects invalid source offsets and unsafe resource paths", () => {
  const given = {
    editionId: "edition-1",
    normalizationRevisionId: "normalization-1",
    resourcePath: "../secret",
    blockId: "block-1",
    start: 4,
    end: 2,
    originalFragment: "source",
  }
  const result = SourceSpan.safeParse(given)
  expect(result.success).toBe(false)
})
it("rejects malformed original hashes", () => {
  const result = BookEdition.safeParse({
    id: "edition-1",
    originalHash: "wrong",
    originalBlobHash: hash,
    title: "Synthetic",
  })
  expect(result.success).toBe(false)
})
it("rejects duplicate normalized block IDs", () => {
  const block = { id: "block-1", text: "Synthetic" }
  const result = NormalizationRevision.safeParse({
    id: "normalization-1",
    editionId: "edition-1",
    editionHash: hash,
    parserVersion: "1",
    normalizerVersion: "1",
    coverage: "complete",
    resources: [
      { path: "ch1.xhtml", role: "main-chapter", status: "included", blocks: [block, block] },
    ],
  })
  expect(result.success).toBe(false)
})
it("rejects forged analysis keys and incomplete successful scope", () => {
  const result = AnalysisRevision.safeParse({
    id: "analysis-1",
    cacheInput,
    cacheKey: "b".repeat(64),
    status: "successful",
    chapters: [],
    claims: [],
    concepts: [],
    qualifications: [],
  })
  expect(result.success).toBe(false)
})
it("rejects historical or cross-installation grants at an authorization boundary", () => {
  const grant = {
    kind: "active",
    id: "grant-1",
    setupRevisionId: "setup-1",
    installationId: "installation-1",
    ownerId: "owner-1",
    categories: ["book-text"],
    approvedAt: "2026-09-18T00:00:00Z",
  }
  const given = {
    setup,
    grant,
    installationId: "installation-2",
    ownerId: "owner-1",
    categories: ["book-text"],
  }
  expect(TransmissionAuthorization.safeParse(given).success).toBe(false)
  expect(
    TransmissionAuthorization.safeParse({
      ...given,
      installationId: "installation-1",
      grant: { ...grant, kind: "historical" },
    }).success,
  ).toBe(false)
})
