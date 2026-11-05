import { z } from "zod"

export { CodexOutputFormat, codexOutputFormat } from "@reading-studio/contracts"
export const Started = z.object({
  cwd: z.string(),
  thread: z.object({ id: z.string().max(256) }),
  model: z.string(),
  modelProvider: z.string(),
  instructionSources: z.array(z.string()),
  sandbox: z.object({ type: z.literal("readOnly") }),
})
export const Phase = z.enum(["commentary", "partial_answer", "final_answer"]).nullish()
export const Item = z.object({
  turnId: z.string().max(256),
  item: z.object({
    type: z.literal("agentMessage"),
    text: z.string(),
    phase: z.unknown().optional(),
  }),
})
export const Terminal = z.object({
  turn: z.object({
    id: z.string(),
    status: z.string(),
    error: z.object({ codexErrorInfo: z.unknown().optional() }).nullish(),
  }),
})
export const Usage = z.object({
  tokenUsage: z.object({
    last: z.object({
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
    }),
  }),
})
