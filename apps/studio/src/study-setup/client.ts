import { NormalizationRevision } from "@reading-studio/contracts/source"
import { z } from "zod"

const Provider = z.enum(["openai", "anthropic", "openrouter", "codex"])
const Scope = z.enum(["all-main-chapters", "partial"])
export const SetupChoices = z.object({
  normalization: NormalizationRevision,
  choices: z.array(z.object({ provider: Provider, model: z.string(), label: z.string() })),
})
export const SetupReview = z.object({
  setup: z.object({
    id: z.string(),
    analysis: z.object({
      provider: Provider,
      model: z.string(),
      normalizationRevisionId: z.string(),
      scope: z.object({
        kind: Scope,
        selected: z.array(z.object({ resourcePath: z.string(), blockIds: z.array(z.string()) })),
      }),
    }),
  }),
  normalization: NormalizationRevision,
  available: z.boolean(),
})
export const SetupCreated = z.object({ setupId: z.string() })
export const SetupDecision = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("send"), grantId: z.string() }),
  z.object({ decision: z.literal("revise") }),
  z.object({ decision: z.literal("cancel") }),
])
export type SetupSelection = {
  readonly provider: z.infer<typeof Provider>
  readonly model: string
  readonly scope: z.infer<typeof Scope>
  readonly chapters: readonly string[]
}
