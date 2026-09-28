import { z } from "zod"
import { AnswerSubmission } from "./choices.ts"
import { SourceScope } from "./lineage.ts"
import {
  AnalysisRevisionId,
  Bilingual,
  BriefRevisionId,
  InputRevisionId,
  SetupRevisionId,
  StudyId,
  Text,
  uniqueValues,
} from "./primitives.ts"

export const BriefContent = z
  .strictObject({
    originalQuestion: Bilingual,
    refinedQuestion: Bilingual.nullable(),
    questionChoice: z.enum(["original", "refined"]),
    supportingQuestions: z.array(Bilingual).max(3).readonly(),
    purpose: Text,
    context: Text,
    depth: z.enum(["overview", "focused", "deep"]),
    language: z.enum(["en", "ja", "paired"]),
    spoilerPolicy: z.enum(["allow", "avoid"]),
    exclusions: uniqueValues(Text),
  })
  .refine(
    (value) => value.questionChoice === "original" || value.refinedQuestion !== null,
    "A refined question must exist before selecting it",
  )
  .readonly()
export type BriefContent = z.infer<typeof BriefContent>

export const BriefDraft = z
  .strictObject({
    id: BriefRevisionId,
    studyId: StudyId,
    setupRevisionId: SetupRevisionId,
    analysisRevisionId: AnalysisRevisionId,
    interviewId: InputRevisionId,
    answerVersion: z.number().int().nonnegative(),
    content: BriefContent,
    scope: SourceScope,
    answers: z.array(AnswerSubmission).readonly(),
  })
  .readonly()
export type BriefDraft = z.infer<typeof BriefDraft>
export const BriefSave = z
  .strictObject({
    studyId: StudyId,
    expectedRevisionId: BriefRevisionId.nullable(),
    content: BriefContent,
  })
  .readonly()
export const BriefDecision = z
  .strictObject({
    studyId: StudyId,
    revisionId: BriefRevisionId,
    action: z.enum(["approve", "revise", "defer"]),
  })
  .readonly()
export type BriefStatus = "pending" | "approved" | "revise" | "defer" | "outdated"
export type BriefView = { readonly draft: BriefDraft; readonly status: BriefStatus }

export function guidingQuestion(content: BriefContent): Bilingual {
  return content.questionChoice === "refined" && content.refinedQuestion
    ? content.refinedQuestion
    : content.originalQuestion
}
