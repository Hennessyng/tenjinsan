import { Bilingual, type OutlineContent } from "@reading-studio/contracts"
import { generationStage } from "@reading-studio/generation/provider-stages"
import { defaultSettings, localRequestBytes, structuredRequest } from "@reading-studio/providers"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { z } from "zod"
import { outlineContractFixture } from "./outline-contract-fixture.ts"

const fixtures: ReturnType<typeof outlineContractFixture>[] = []
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new TypeError("Network forbidden")
    }),
  )
})
afterEach(() => {
  try {
    expect(fetch).not.toHaveBeenCalled()
  } finally {
    for (const fixture of fixtures.splice(0)) fixture.close()
    vi.unstubAllGlobals()
  }
})
function given(supporting: readonly z.infer<typeof Bilingual>[] = []) {
  const fixture = outlineContractFixture(supporting)
  fixtures.push(fixture)
  return fixture
}

it("provides exact retained records and approved question indices, not interview indices", () => {
  // Given
  const { stage, brief, analysis } = given()
  let value: unknown
  // When
  try {
    value = JSON.parse(stage.instruction.split("\n")[0] ?? "")
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
  }
  const parsed = z
    .object({
      outlineContract: z.object({
        retained: z.object({
          qualifications: z.array(z.unknown()),
          excludedAreas: z.array(z.string()),
        }),
        approvedQuestions: z.array(z.object({ questionIndex: z.number(), question: Bilingual })),
      }),
    })
    .safeParse(value)
  // Then
  expect(parsed.success).toBe(true)
  if (!parsed.success) throw new TypeError("Structured outline contract missing")
  expect(brief.answers).toHaveLength(3)
  expect(parsed.data.outlineContract).toEqual({
    retained: { qualifications: analysis.qualifications, excludedAreas: brief.exclusions },
    approvedQuestions: [{ questionIndex: 0, question: brief.guidingQuestion }],
  })
})

it("rejects the observed changed qualification ID at its exact safe path without replacing it", () => {
  // Given
  const { stage, good } = given()
  const changed = {
    ...good,
    qualifications: good.qualifications.map((item) => ({ ...item, id: "changed-retained-id" })),
  }
  // When
  const parsed = stage.schema.safeParse(changed)
  // Then
  expect(parsed.success).toBe(false)
  if (parsed.success) throw new TypeError("Changed retained ID must remain invalid")
  expect(parsed.error.issues).toContainEqual(
    expect.objectContaining({
      code: "custom",
      path: ["qualifications", 0, "id"],
      params: { rule: "retain-outline-qualifications" },
    }),
  )
  expect(changed.qualifications[0]?.id).toBe("changed-retained-id")
})

it("rejects dropped exclusions with safe retained-field metadata", () => {
  // Given
  const { stage, good } = given()
  // When
  const parsed = stage.schema.safeParse({ ...good, excludedAreas: [] })
  // Then
  expect(parsed.success).toBe(false)
  if (parsed.success) throw new TypeError("Exclusions must remain retained")
  expect(parsed.error.issues).toContainEqual(
    expect.objectContaining({
      code: "custom",
      path: ["excludedAreas"],
      params: { rule: "retain-outline-exclusions" },
    }),
  )
})

it.each([
  {
    field: "text",
    path: ["qualifications", 0, "text"],
    change: (good: OutlineContent) => ({
      ...good,
      qualifications: good.qualifications.map((item) => ({
        ...item,
        text: "Changed synthetic qualification",
      })),
    }),
  },
  {
    field: "sources",
    path: ["qualifications", 0, "sources"],
    change: (good: OutlineContent) => ({
      ...good,
      qualifications: good.qualifications.map((item) => ({
        ...item,
        sources: item.sources.map((span) => ({ ...span, start: span.start + 1 })),
      })),
    }),
  },
  {
    field: "missing",
    path: ["qualifications"],
    change: (good: OutlineContent) => ({ ...good, qualifications: [] }),
  },
])("retains strict qualification $field checks", ({ path, change }) => {
  // Given
  const { stage, good } = given()
  // When
  const parsed = stage.schema.safeParse(change(good))
  // Then
  expect(parsed.success).toBe(false)
  if (parsed.success) throw new TypeError("Qualification changes must remain invalid")
  expect(parsed.error.issues).toContainEqual(
    expect.objectContaining({
      code: "custom",
      path,
      params: { rule: "retain-outline-qualifications" },
    }),
  )
})

it("rejects the two observed out-of-range provider indices with precise metadata", () => {
  // Given
  const { stage, good } = given()
  const invalid = {
    ...good,
    sections: good.sections.map((section, index) => ({ ...section, questionIndex: index })),
  }
  // When
  const parsed = stage.schema.safeParse(invalid)
  // Then
  expect(parsed.success).toBe(false)
  if (parsed.success) throw new TypeError("Out-of-range provider indices must be invalid")
  for (const index of [1, 2])
    expect(parsed.error.issues).toContainEqual(
      expect.objectContaining({
        code: "custom",
        path: ["sections", index, "questionIndex"],
        params: { rule: "approved-outline-question-index" },
      }),
    )
  expect(invalid.sections.map((section) => section.questionIndex)).toEqual([0, 1, 2])
})

it("allows repeated valid indices and the final supporting-question index", () => {
  // Given
  const supporting = [{ en: "Where are the limits?", ja: "限界はどこですか？" }]
  const { stage, good } = given(supporting)
  // When / Then
  expect(
    stage.schema.safeParse({
      ...good,
      sections: good.sections.map((section, index) => ({
        ...section,
        questionIndex: index === 0 ? 0 : 1,
      })),
    }).success,
  ).toBe(true)
})

it("keeps citation membership strict", () => {
  // Given
  const { stage, good } = given()
  // When
  const parsed = stage.schema.safeParse({
    ...good,
    sections: good.sections.map((section) => ({
      ...section,
      sources: section.sources.map((span) => ({ ...span, blockId: "foreign-block" })),
    })),
  })
  // Then
  expect(parsed.success).toBe(false)
})

it("preserves manual flag handling and refuses approval of flagged sections", () => {
  // Given
  const { storage, brief, good } = given()
  const manual = {
    ...good,
    sections: good.sections.map((section, index) => ({ ...section, questionIndex: index })),
  }
  // When
  const draft = storage.outlines.save({
    studyId: brief.studyId,
    briefRevisionId: brief.id,
    expectedRevisionId: null,
    content: manual,
    feedback: null,
  })
  // Then
  expect(
    draft.content.sections.filter((section) => section.flags.includes("irrelevant-section")),
  ).toHaveLength(2)
  expect(() =>
    storage.outlines.decide({ studyId: brief.studyId, revisionId: draft.id, action: "approve" }),
  ).toThrow("requires revision")
  expect(storage.outlines.approved(draft.id)).toBeNull()
  expect(storage.counts()).toMatchObject({ jobs: 0, attempts: 0 })
})

it("still requires explicit approval for a valid outline", () => {
  // Given
  const { storage, brief, good, stage } = given()
  // When
  expect(stage.schema.safeParse(good).success).toBe(true)
  const draft = storage.outlines.save({
    studyId: brief.studyId,
    briefRevisionId: brief.id,
    expectedRevisionId: null,
    content: good,
    feedback: null,
  })
  // Then
  expect(storage.outlines.approved(draft.id)).toBeNull()
  storage.outlines.decide({ studyId: brief.studyId, revisionId: draft.id, action: "approve" })
  expect(storage.outlines.approved(draft.id)?.id).toBe(draft.id)
  expect(storage.counts()).toMatchObject({ jobs: 0, attempts: 0 })
})

it("does not build a provider stage after the exact brief approval is withdrawn", () => {
  // Given
  const { storage, brief, job } = given()
  storage.briefs.decide({ studyId: brief.studyId, revisionId: brief.id, action: "revise" })
  // When / Then
  expect(() => generationStage(storage, job)).toThrow("Current approved brief required")
  expect(storage.counts()).toMatchObject({ jobs: 0, attempts: 0 })
})

it("includes the structured contract in the measured ChatGPT request without dispatch", () => {
  // Given
  const { stage } = given()
  const input = {
    model: "study-model",
    settings: defaultSettings,
    schema: z.toJSONSchema(stage.schema),
    blocks: [],
    signal: new AbortController().signal,
  }
  // When
  const request = structuredRequest({ ...input, instruction: stage.instruction })
  const envelope = z
    .object({
      outlineContract: z.object({
        approvedQuestions: z.array(z.object({ questionIndex: z.number() })),
      }),
    })
    .parse(JSON.parse(request.prompt.split("\n")[0] ?? ""))
  const bytes = localRequestBytes("chatgpt-subscription", request)
  // Then
  expect(
    envelope.outlineContract.approvedQuestions.map((question) => question.questionIndex),
  ).toEqual([0])
  expect(bytes).toBeGreaterThan(
    localRequestBytes("chatgpt-subscription", structuredRequest({ ...input, instruction: "" })),
  )
  expect(bytes).toBeLessThanOrEqual(32000)
})
