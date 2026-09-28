import { describe, expect, it } from "vitest"
import { AnswerSubmission, Question } from "../src/index.ts"

export const question = {
  id: "question-1",
  revisionId: "question-rev-1",
  analysisRevisionId: "analysis-1",
  prompt: { en: "Choose a focus", ja: "焦点を選ぶ" },
  mode: "multi",
  options: [
    { id: "option-1", label: { en: "Presence", ja: "寄り添う" } },
    { id: "option-2", label: { en: "Listening", ja: "聴く" } },
  ],
  minSelections: 1,
  maxSelections: 2,
  policy: { custom: true, unsure: true, skip: true },
}
const answer = {
  kind: "choice",
  questionId: "question-1",
  questionRevisionId: "question-rev-1",
  optionIds: ["option-1"],
}

describe("choice boundaries", () => {
  it("round trips bilingual choices when revision and options match", () => {
    const given = { question, answer }
    const result = AnswerSubmission.parse(given)
    expect(JSON.parse(JSON.stringify(result))).toEqual(given)
    expect(Object.isFrozen(result.question.options)).toBe(true)
  })
  it.each([
    { ...answer, optionIds: ["stale-option"] },
    { ...answer, optionIds: ["option-1", "option-1"] },
    { ...answer, optionIds: [] },
    { ...answer, questionRevisionId: "old-revision" },
    { ...answer, questionId: "other-question" },
    { ...answer, kind: "unsure" },
    { ...answer, kind: "skipped" },
    { kind: "custom", questionId: "question-1", questionRevisionId: "question-rev-1", text: "  " },
  ])("rejects incompatible answers when input is %j", (invalid) => {
    const result = AnswerSubmission.safeParse({ question, answer: invalid })
    expect(result.success).toBe(false)
  })
  it.each([
    { ...question, options: [question.options[0], question.options[0]] },
    { ...question, minSelections: 3 },
    { ...question, maxSelections: 3 },
    { ...question, mode: "single", maxSelections: 2 },
    { ...question, secret: "private" },
  ])("rejects malformed questions when bounds or IDs are invalid", (invalid) => {
    const result = Question.safeParse(invalid)
    expect(result.success).toBe(false)
  })
  it.each(["custom", "unsure", "skipped"])(
    "rejects disabled policy when %s is submitted",
    (kind) => {
      const given = {
        question: { ...question, policy: { custom: false, unsure: false, skip: false } },
        answer: {
          kind,
          questionId: "question-1",
          questionRevisionId: "question-rev-1",
          ...(kind === "custom" ? { text: "Personal goal" } : {}),
        },
      }
      const result = AnswerSubmission.safeParse(given)
      expect(result.success).toBe(false)
    },
  )
})
