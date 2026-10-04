import { z } from "zod"
import { Question } from "./choices.ts"
import {
  AnalysisRevisionId,
  Bilingual,
  InputRevisionId,
  QuestionId,
  StudyId,
  Text,
  uniqueItems,
  uniqueValues,
} from "./primitives.ts"

export const InterviewDefinition = z
  .strictObject({
    id: InputRevisionId,
    studyId: StudyId,
    analysisRevisionId: AnalysisRevisionId,
    contextRevisionId: InputRevisionId,
    groups: uniqueItems(z.strictObject({ id: Text, label: Bilingual }).readonly()),
    steps: z
      .array(
        z
          .strictObject({
            groupId: Text,
            purpose: z.enum(["preference", "approval"]),
            question: Question,
          })
          .readonly(),
      )
      .min(1)
      .readonly(),
    shortlist: uniqueValues(QuestionId).refine((ids) => ids.length > 0),
  })
  .superRefine((value, ctx) => {
    const ids = value.steps.map((step) => step.question.id)
    if (new Set(ids).size !== ids.length || value.shortlist.some((id) => !ids.includes(id)))
      ctx.addIssue({ code: "custom", message: "invalid interview question identities" })
    for (const step of value.steps) {
      if (
        !value.groups.some((group) => group.id === step.groupId) ||
        step.question.analysisRevisionId !== value.analysisRevisionId
      )
        ctx.addIssue({ code: "custom", message: "interview lineage mismatch" })
      if (
        step.purpose === "approval" &&
        (step.question.policy.skip || step.question.policy.unsure || step.question.policy.custom)
      )
        ctx.addIssue({ code: "custom", message: "approval requires an explicit decision" })
    }
  })
  .readonly()
export type InterviewDefinition = z.infer<typeof InterviewDefinition>
