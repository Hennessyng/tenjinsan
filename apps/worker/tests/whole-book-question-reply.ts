import type { ProviderReceipt, StructuredRequest } from "@reading-studio/providers"
import { z } from "zod"

export function fixtureQuestionReply(request: StructuredRequest): ProviderReceipt | null {
  const instruction = request.prompt.slice(0, request.prompt.lastIndexOf("\n"))
  const question = z
    .object({
      task: z.literal("question-evidence-refs-v1"),
      binding: z.string(),
      citations: z.array(z.object({ id: z.string() })),
    })
    .safeParse(instruction.startsWith("{") ? JSON.parse(instruction) : null)
  if (!question.success) return null
  const label = { en: "A synthetic question", ja: "合成の質問" }
  const refs = question.data.citations.slice(0, 1).map((item) => item.id)
  return {
    kind: "output",
    usage: { kind: "known", inputTokens: 10, outputTokens: 10 },
    text: JSON.stringify({
      version: question.data.task,
      binding: question.data.binding,
      groups: [{ id: "group-1", label }],
      lenses: [
        {
          id: "lens-1",
          groupId: "group-1",
          learningGoalKey: "synthetic",
          label,
          rationale: label,
          prompt: label,
          mode: "single",
          minSelections: 1,
          maxSelections: 1,
          evidenceRefs: refs,
          complications: [{ label, evidenceRefs: refs }],
          options: [{ id: "option-1", goalKey: "synthetic", label, rationale: label }],
        },
      ],
    }),
  }
}
