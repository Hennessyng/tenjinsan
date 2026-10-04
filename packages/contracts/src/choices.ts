import { z } from "zod"
import {
  AnalysisRevisionId,
  assertNever,
  Bilingual,
  OptionId,
  QuestionId,
  QuestionRevisionId,
  Text,
  uniqueItems,
  uniqueValues,
} from "./primitives.ts"
import { SourceSpan } from "./source.ts"

export const QuestionOption = z.strictObject({ id: OptionId, label: Bilingual }).readonly()
const fields = {
  id: QuestionId,
  revisionId: QuestionRevisionId,
  analysisRevisionId: AnalysisRevisionId,
  prompt: Bilingual,
  options: uniqueItems(QuestionOption).refine((items) => items.length > 0),
  policy: z
    .strictObject({ custom: z.boolean(), unsure: z.boolean(), skip: z.boolean() })
    .readonly(),
  lens: z
    .strictObject({ label: Bilingual, sources: z.array(SourceSpan).min(1).readonly() })
    .readonly()
    .optional(),
}
export const Question = z
  .discriminatedUnion("mode", [
    z.strictObject({
      ...fields,
      mode: z.literal("single"),
      minSelections: z.literal(1),
      maxSelections: z.literal(1),
    }),
    z.strictObject({
      ...fields,
      mode: z.literal("multi"),
      minSelections: z.number().int().positive(),
      maxSelections: z.number().int().positive(),
    }),
  ])
  .refine(
    (question) =>
      question.minSelections <= question.maxSelections &&
      question.maxSelections <= question.options.length,
    "selection bounds exceed available options",
  )
  .readonly()
export type Question = z.infer<typeof Question>
const reference = { questionId: QuestionId, questionRevisionId: QuestionRevisionId }
export const Answer = z
  .discriminatedUnion("kind", [
    z.strictObject({
      ...reference,
      kind: z.literal("choice"),
      optionIds: uniqueValues(OptionId).refine((ids) => ids.length > 0),
    }),
    z.strictObject({ ...reference, kind: z.literal("custom"), text: Text }),
    z.strictObject({ ...reference, kind: z.literal("unsure") }),
    z.strictObject({ ...reference, kind: z.literal("skipped") }),
  ])
  .readonly()
export type Answer = z.infer<typeof Answer>
export const AnswerSubmission = z
  .strictObject({ question: Question, answer: Answer })
  .superRefine(({ question, answer }, ctx) => {
    if (question.id !== answer.questionId || question.revisionId !== answer.questionRevisionId)
      ctx.addIssue({ code: "custom", message: "stale or mismatched question revision" })
    let compatible: boolean
    switch (answer.kind) {
      case "choice":
        compatible =
          answer.optionIds.length >= question.minSelections &&
          answer.optionIds.length <= question.maxSelections &&
          answer.optionIds.every((id) => question.options.some((option) => option.id === id))
        break
      case "custom":
        compatible = question.policy.custom
        break
      case "unsure":
        compatible = question.policy.unsure
        break
      case "skipped":
        compatible = question.policy.skip
        break
      default:
        return assertNever(answer)
    }
    if (!compatible) ctx.addIssue({ code: "custom", message: "answer violates question policy" })
  })
  .readonly()
export type AnswerSubmission = z.infer<typeof AnswerSubmission>

export const QuestionSet = z
  .strictObject({
    analysisRevisionId: AnalysisRevisionId,
    questions: uniqueItems(Question).refine((questions) => questions.length > 0),
  })
  .refine(
    (set) =>
      set.questions.every((question) => question.analysisRevisionId === set.analysisRevisionId),
    "question analysis lineage mismatch",
  )
  .readonly()
