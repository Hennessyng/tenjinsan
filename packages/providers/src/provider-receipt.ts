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
const AppWire = z.strictObject({
  version: z.literal("app-rpc-frame-1"),
  layer: z.literal("app-server-stdin-frames"),
  bytes: z.number().int().nonnegative(),
  downstreamInput: z.literal("unmeasured"),
  frames: z
    .array(
      z.strictObject({
        version: z.literal("app-rpc-frame-1"),
        layer: z.literal("app-server-stdin-frame"),
        id: z.number().int().positive(),
        method: z.string(),
        bytes: z.number().int().nonnegative(),
        sha256: z.string().regex(/^[a-f0-9]{64}$/u),
        binding: z
          .string()
          .regex(/^[a-f0-9]{64}$/u)
          .nullable(),
        downstreamInput: z.literal("unmeasured"),
      }),
    )
    .length(2),
})
export const ProviderReceipt = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("output"),
    text: z.string(),
    usage,
    outputFormat: CodexOutputFormat.optional(),
    appWire: AppWire.optional(),
  }),
  z.strictObject({
    kind: z.literal("error"),
    code: z.enum([
      "rate-limited",
      "rejected",
      "unavailable",
      "refused",
      "truncated",
      "protocol-error",
    ]),
    usage,
    outputFormat: CodexOutputFormat.optional(),
    appWire: AppWire.optional(),
    diagnostic: z
      .enum([
        "request-rejected",
        "access-rejected",
        "rate-limited",
        "provider-unavailable",
        "transport-failure",
        "client-capability-denied",
        "terminal-unclassified",
        "unsupported-message-phase",
      ])
      .optional(),
  }),
])
export type ProviderReceipt = z.infer<typeof ProviderReceipt>
