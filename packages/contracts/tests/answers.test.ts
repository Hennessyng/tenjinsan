import { describe, expect, it } from "vitest"
import { AnswerSubmission, InterviewDefinition } from "../src/index.ts"

const question = {
  id: "focus",
  revisionId: "focus-v1",
  analysisRevisionId: "analysis-1",
  prompt: { en: "Choose a focus", ja: "視点を選ぶ" },
  mode: "multi",
  minSelections: 1,
  maxSelections: 2,
  options: ["one", "two", "three"].map((id) => ({ id, label: { en: id, ja: id } })),
  policy: { custom: true, unsure: true, skip: true },
}
const definition = {
  id: "interview-1",
  studyId: "study-1",
  analysisRevisionId: "analysis-1",
  contextRevisionId: "context-1",
  groups: [{ id: "goals", label: { en: "Goals", ja: "目的" } }],
  steps: [{ groupId: "goals", purpose: "preference", question }],
  shortlist: ["focus"],
}
describe("answers", () => {
  it("preserves exact question snapshots when parsing an interview", () => {
    // Given / When
    const result = InterviewDefinition.parse(definition)
    // Then
    expect(result.steps[0]?.question).toEqual(question)
  })
  it("rejects skippable approvals when defining required decisions", () => {
    // Given
    const input = { ...definition, steps: [{ ...definition.steps[0], purpose: "approval" }] }
    // When / Then
    expect(InterviewDefinition.safeParse(input).success).toBe(false)
  })
  it.each([
    { kind: "choice", optionIds: [] },
    { kind: "choice", optionIds: ["one", "two", "three"] },
    { kind: "unsure", optionIds: ["one"] },
    { kind: "skipped", optionIds: ["one"] },
    { kind: "custom", text: " " },
    { kind: "choice", optionIds: ["obsolete"] },
    { kind: "choice", optionIds: ["one"], questionRevisionId: "old" },
  ])("rejects invalid submissions: %j", (answer) => {
    // Given / When
    const result = AnswerSubmission.safeParse({
      question,
      answer: { questionId: "focus", questionRevisionId: "focus-v1", ...answer },
    })
    // Then
    expect(result.success).toBe(false)
  })
})
