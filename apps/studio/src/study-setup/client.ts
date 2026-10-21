import { Provider } from "@reading-studio/contracts/provider"
import {
  SetupAnalysisProgress,
  SetupSchedulingFailure,
} from "@reading-studio/contracts/setup-progress"
import { NormalizationRevision } from "@reading-studio/contracts/source"
import { SubscriptionDestination } from "@reading-studio/contracts/subscriptions"
import { z } from "zod"

// Stored setups may still carry a historical scope kind; review displays it unchanged.
const Scope = z.enum(["whole-document", "all-main-chapters", "partial"])
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
      destination: SubscriptionDestination.optional(),
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
  z.object({
    decision: z.literal("send"),
    grantId: z.string(),
    analysisProgress: SetupAnalysisProgress.default("unknown"),
    progressUrl: z.string().startsWith("/jobs?setup=").optional(),
    questionsUrl: z.string().startsWith("/interviews/").optional(),
    schedulingFailure: SetupSchedulingFailure.nullable().default(null),
    canResume: z.boolean().default(false),
  }),
  z.object({ decision: z.literal("revise") }),
  z.object({ decision: z.literal("cancel") }),
])
export const SetupReviewResponse = z.union([SetupReview, SetupDecision])
export type SavedSetupDecision = Extract<z.infer<typeof SetupDecision>, { decision: "send" }>
/** A new setup is only a provider and model: it always covers the whole extraction. */
export type SetupSelection = {
  readonly provider: z.infer<typeof Provider>
  readonly model: string
}
