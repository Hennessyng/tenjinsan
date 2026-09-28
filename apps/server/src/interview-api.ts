import { type InterviewDefinition, StudyId } from "@reading-studio/contracts"
import { ContractBoundaryError, type InterviewRepository } from "@reading-studio/storage"
import type { Hono } from "hono"
import { z } from "zod"
import type { AppEnvironment } from "./middleware/access.ts"

const reference = {
  interviewId: z.string(),
  questionId: z.string(),
  questionRevisionId: z.string(),
}
const Submission = z.discriminatedUnion("kind", [
  z.strictObject({
    ...reference,
    kind: z.literal("choice"),
    optionIds: z
      .union([z.string(), z.array(z.string())])
      .transform((value) => (typeof value === "string" ? [value] : value)),
  }),
  z.strictObject({ ...reference, kind: z.literal("custom"), text: z.string() }),
  z.strictObject({ ...reference, kind: z.literal("unsure") }),
  z.strictObject({ ...reference, kind: z.literal("skipped") }),
])

export function saveInterviewAnswer(
  interviews: InterviewRepository,
  definition: InterviewDefinition,
  input: unknown,
):
  | { readonly kind: "saved"; readonly questionId: string }
  | { readonly kind: "invalid" | "stale" } {
  const parsed = Submission.safeParse(input)
  if (!parsed.success) return { kind: "invalid" }
  const { interviewId, ...answer } = parsed.data
  try {
    interviews.save({ studyId: definition.studyId, interviewId, answer })
  } catch (error) {
    if (error instanceof ContractBoundaryError || error instanceof z.ZodError)
      return { kind: "stale" }
    throw error
  }
  return { kind: "saved", questionId: answer.questionId }
}

export function configureInterviewApi(
  app: Hono<AppEnvironment>,
  interviews: InterviewRepository,
): void {
  app.get("/api/interviews", (context) => {
    context.header("Cache-Control", "private, no-store")
    return context.json({ definitions: interviews.listOwned(context.get("ownerId")) })
  })
  app.get("/api/interviews/:study", (context) => {
    context.header("Cache-Control", "private, no-store")
    const id = StudyId.safeParse(context.req.param("study"))
    const definition = id.success ? interviews.owned(id.data, context.get("ownerId")) : null
    return definition
      ? context.json({ definition, answers: interviews.answers(definition.id) })
      : context.json({ error: "Interview unavailable" }, 404)
  })
  app.post("/api/interviews/:study", async (context) => {
    context.header("Cache-Control", "private, no-store")
    const id = StudyId.safeParse(context.req.param("study"))
    const definition = id.success ? interviews.owned(id.data, context.get("ownerId")) : null
    if (!definition) return context.json({ error: "Interview unavailable" }, 404)
    const result = saveInterviewAnswer(interviews, definition, await context.req.json())
    switch (result.kind) {
      case "saved":
        return context.json({ saved: true as const })
      case "invalid":
        return context.json({ error: "Invalid answer" }, 422)
      case "stale":
        return context.json({ error: "Stale or invalid answer" }, 409)
      default:
        return assertNever(result)
    }
  })
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected interview result: ${value}`)
}
