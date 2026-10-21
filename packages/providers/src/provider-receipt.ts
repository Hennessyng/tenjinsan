import { z } from "zod"
import { CodexOutputFormat } from "./local-codex-schema.ts"

const usage = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("known"),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
  }),
  z.strictObject({ kind: z.literal("unknown") }),
])
export const ProviderReceipt = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("output"),
    text: z.string(),
    usage,
    outputFormat: CodexOutputFormat.optional(),
  }),
  z.strictObject({
    kind: z.literal("error"),
    code: z.enum(["rate-limited", "rejected", "unavailable", "refused", "truncated"]),
    usage,
    outputFormat: CodexOutputFormat.optional(),
    diagnostic: z
      .enum([
        "request-rejected",
        "access-rejected",
        "rate-limited",
        "provider-unavailable",
        "transport-failure",
        "client-capability-denied",
        "terminal-unclassified",
      ])
      .optional(),
  }),
])
export type ProviderReceipt = z.infer<typeof ProviderReceipt>
