import { AnswerSubmission } from "@reading-studio/contracts/choices"
import { InterviewDefinition } from "@reading-studio/contracts/interview"
import { z } from "zod"

export const InterviewState = z.object({
  definition: InterviewDefinition,
  answers: z.array(AnswerSubmission),
})
export const InterviewList = z.object({ definitions: z.array(InterviewDefinition) })
export const SavedAnswer = z.object({ saved: z.literal(true) })
export type Interview = z.infer<typeof InterviewState>
export type Step = Interview["definition"]["steps"][number]
export type Saved = Interview["answers"][number]
