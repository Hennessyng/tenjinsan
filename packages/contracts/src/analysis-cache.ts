import { z } from "zod"
import { AnalysisEvaluationPurpose } from "./analysis-purpose.ts"
import { PreparedRange } from "./book-preparation.ts"
import { contentDigest } from "./identity.ts"
import { Digest, NormalizationRevisionId, Text } from "./primitives.ts"
import { Provider } from "./provider.ts"
import { SourceScope } from "./source-scope.ts"
import { isSubscriptionProvider, SubscriptionDestination } from "./subscriptions.ts"

export const ModelSettings = z
  .strictObject({
    temperature: z.number().min(0).max(2),
    topP: z.number().min(0).max(1),
    maxOutputTokens: z.number().int().positive().max(1_000_000),
    seed: z.number().int().nullable(),
    reasoningEffort: z.enum(["default", "low", "medium", "high"]),
  })
  .readonly()
export const AnalysisCacheInput = z
  .strictObject({
    editionHash: Digest,
    normalizationRevisionId: NormalizationRevisionId,
    scope: SourceScope,
    provider: Provider,
    model: Text,
    destination: SubscriptionDestination.optional(),
    analysisPromptVersion: Text,
    analysisSchemaVersion: Text,
    processing: z
      .strictObject({
        preprocessingVersion: Text,
        synthesisVersion: Text,
        capacityId: Text,
        inferencePolicyVersion: Text.optional(),
        batchReserveId: Digest.optional(),
        plan: z
          .array(
            z
              .strictObject({ groupId: Text, ranges: z.array(PreparedRange).min(1).readonly() })
              .readonly(),
          )
          .min(1)
          .max(128)
          .readonly()
          .optional(),
      })
      .readonly()
      .optional(),
    settings: ModelSettings,
    purpose: AnalysisEvaluationPurpose.optional(),
  })
  .refine(
    (input) =>
      isSubscriptionProvider(input.provider)
        ? input.destination?.provider === input.provider
        : input.destination === undefined,
    "subscription destination must match provider",
  )
  .readonly()
export type AnalysisCacheInput = z.infer<typeof AnalysisCacheInput>
export function analysisCacheKey(input: AnalysisCacheInput): Digest {
  return contentDigest(
    JSON.stringify([
      input.editionHash,
      input.normalizationRevisionId,
      input.scope.kind,
      input.scope.selected.map((resource) => [resource.resourcePath, resource.blockIds]),
      input.scope.exclusions.map((resource) => [resource.resourcePath, resource.blockIds]),
      input.provider,
      input.model,
      input.analysisPromptVersion,
      input.analysisSchemaVersion,
      input.settings.temperature,
      input.settings.topP,
      input.settings.maxOutputTokens,
      input.settings.seed,
      input.settings.reasoningEffort,
      ...(input.processing
        ? [
            [
              input.processing.preprocessingVersion,
              input.processing.synthesisVersion,
              input.processing.capacityId,
              ...(input.processing.inferencePolicyVersion
                ? [input.processing.inferencePolicyVersion]
                : []),
              ...(input.processing.plan ? [input.processing.plan] : []),
              ...(input.processing.batchReserveId
                ? [["batch-reserve-4", input.processing.batchReserveId]]
                : []),
            ],
          ]
        : []),
      ...(input.destination
        ? [
            [
              input.destination.provider,
              input.destination.accountId,
              input.destination.workspaceId,
              input.destination.installationId,
              input.destination.connectionRevision,
              input.destination.billingRoute,
              ...(input.destination.executionPolicy
                ? [
                    input.destination.executionPolicy,
                    input.destination.identityBinding,
                    input.destination.observedAccount,
                  ]
                : []),
            ],
          ]
        : []),
      ...(input.purpose ? [["analysis-purpose", input.purpose]] : []),
    ]),
  )
}
export function baseAnalysisCacheKey(input: AnalysisCacheInput): Digest {
  if (!input.processing?.batchReserveId) return analysisCacheKey(input)
  const { batchReserveId: _reserve, ...processing } = input.processing
  return analysisCacheKey({ ...input, processing })
}
