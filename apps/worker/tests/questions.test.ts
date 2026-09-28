import { AnswerSubmission } from "@reading-studio/contracts"
import { generateQuestions } from "@reading-studio/generation/questions"
import { describe, expect, it } from "vitest"
import { questionsFixture } from "./questions-fixture.ts"

describe("fixture question discovery", () => {
  it("pins revisions and ranks the contextual goal when two chapters contrast", () => {
    // Given
    const { input, draft } = questionsFixture()
    // When
    const result = generateQuestions(input, draft)
    // Then
    expect(result.analysisRevisionId).toBe(input.expected.analysisRevisionId)
    expect(result.contextRevisionId).toBe(input.context.revisionId)
    expect(result.groups).toHaveLength(2)
    expect(result.shortlist[0]).toBe("lens-1")
    expect(result.customQuestion).toBe(input.context.customQuestion)
    for (const lens of result.lenses) {
      expect(lens.question.lens?.sources).toEqual(lens.sources)
      expect(
        AnswerSubmission.safeParse({
          question: lens.question,
          answer: {
            kind: "custom",
            questionId: lens.id,
            questionRevisionId: lens.question.revisionId,
            text: "My own question",
          },
        }).success,
      ).toBe(true)
    }
  })

  it.each(["analysis", "context", "study", "partial"])("rejects mismatched %s input", (fault) => {
    // Given
    const { input, draft } = questionsFixture()
    const changed = {
      ...input,
      expected: {
        ...input.expected,
        ...(fault === "analysis" ? { analysisRevisionId: "other" } : {}),
        ...(fault === "context" ? { contextRevisionId: "other" } : {}),
        ...(fault === "study" ? { studyId: "other" } : {}),
      },
      analysis: { ...input.analysis, status: fault === "partial" ? "partial" : "successful" },
    }
    // When / Then
    expect(() => generateQuestions(changed, draft)).toThrow()
  })

  it.each([
    "citation",
    "duplicate-id",
    "empty-options",
    "bounds",
    "translation",
    "group",
    "stale-output",
    "free-text",
  ])("rejects %s provider output", (fault) => {
    // Given
    const { input, draft } = questionsFixture()
    const first = draft.lenses[0]
    if (!first) throw new TypeError("fixture lens missing")
    const changed = {
      ...draft,
      ...(fault === "stale-output" ? { contextRevisionId: "old" } : {}),
      lenses: draft.lenses.map((lens) => ({
        ...lens,
        ...(fault === "citation" ? { sources: [{ ...lens.sources[0], start: 999 }] } : {}),
        ...(fault === "duplicate-id" ? { id: first.id } : {}),
        ...(fault === "empty-options" ? { options: [] } : {}),
        ...(fault === "bounds" ? { maxSelections: 3 } : {}),
        ...(fault === "translation" ? { label: { en: "Only English" } } : {}),
        ...(fault === "group" ? { groupId: "absent" } : {}),
        ...(fault === "free-text" ? { mode: "custom" } : {}),
      })),
    }
    // When / Then
    expect(() => generateQuestions(input, changed)).toThrow()
  })

  it("reviews repeated goals and options without changing legal bounds", () => {
    // Given
    const { input, draft } = questionsFixture()
    const first = draft.lenses[0]
    if (!first) throw new TypeError("fixture lens missing")
    const option = first.options[0]
    if (!option) throw new TypeError("fixture option missing")
    const repeated = {
      ...draft,
      lenses: [
        { ...first, options: [...first.options, { ...option, id: "repeated-option" }] },
        ...draft.lenses.slice(1),
        {
          ...first,
          id: "repeated-lens",
          revisionId: "repeated-revision",
          options: first.options.map((item) => ({ ...item, id: `copy-${item.id}` })),
        },
      ],
    }
    // When
    const result = generateQuestions(input, repeated)
    // Then
    expect(result.lenses).toHaveLength(2)
    expect(result.lenses[0]?.question.options).toHaveLength(2)
    expect(result.review.removedLensIds).toEqual(["repeated-lens"])
    expect(result.review.removedOptionIds).toEqual(["repeated-option"])
  })

  it("accepts bounded multi choices", () => {
    // Given
    const { input, draft } = questionsFixture()
    const result = generateQuestions(input, {
      ...draft,
      lenses: draft.lenses.map((lens) => ({
        ...lens,
        mode: "multi",
        minSelections: 1,
        maxSelections: 2,
      })),
    })
    const question = result.lenses[0]?.question
    if (!question) throw new TypeError("fixture question missing")
    // When
    const accepted = AnswerSubmission.safeParse({
      question,
      answer: {
        kind: "choice",
        questionId: question.id,
        questionRevisionId: question.revisionId,
        optionIds: question.options.map((option) => option.id),
      },
    })
    // Then
    expect(accepted.success).toBe(true)
  })

  it("rejects bounds made impossible by deduplication", () => {
    // Given
    const { input, draft } = questionsFixture()
    const changed = {
      ...draft,
      lenses: draft.lenses.map((lens) => ({
        ...lens,
        mode: "multi",
        minSelections: 2,
        maxSelections: 2,
        options: lens.options.map((option) => ({ ...option, goalKey: "same-goal" })),
      })),
    }
    // When / Then
    expect(() => generateQuestions(input, changed)).toThrow("deduplicated-bounds")
  })

  it("rejects fabricated complication evidence", () => {
    // Given
    const { input, draft } = questionsFixture()
    const changed = {
      ...draft,
      lenses: draft.lenses.map((lens) => ({
        ...lens,
        complications: lens.complications.map((item) => ({
          ...item,
          sources: item.sources.map((source) => ({
            ...source,
            originalFragment: "Invented quotation",
          })),
        })),
      })),
    }
    // When / Then
    expect(() => generateQuestions(input, changed)).toThrow("invalid-citation")
  })
})
