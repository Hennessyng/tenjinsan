import { z } from "zod"
import { AnalysisEvaluationPurpose } from "./analysis-purpose.ts"
import { UnsentSourceRange } from "./source.ts"
import {
  VERIFICATION_ROOM_BYTES,
  VERIFICATION_ROOM_PREPROCESSING_VERSION,
} from "./verification-room-policy.ts"

export const SetupAnalysisProgress = z.enum([
  "queued",
  "analysis-ready",
  "questions-queued",
  "questions-ready",
  "questions-unknown",
  "questions-attention",
  "bank-incompatible",
  "attention",
  "not-scheduled",
  "unknown",
])
export type SetupAnalysisProgress = z.infer<typeof SetupAnalysisProgress>

export const SetupSchedulingFailure = z.enum([
  "scheduling-interrupted",
  "local-only",
  "provider-unavailable",
  "missing-credentials",
  "unsupported-model",
  "unsupported-settings",
  "unauthorized",
  "input-limit",
  "subscription-unverified",
  "subscription-connection-changed",
  "outcome-unknown",
  "bank-incompatible",
  "analysis-window-limit",
  "empty-text-scope",
  "request-byte-limit",
  "route-re-review-required",
  "capacity-unknown",
  "capacity-limit",
  "attempt-budget-limit",
  "analysis-incomplete",
  "unsupported-version",
])
export type SetupSchedulingFailure = z.infer<typeof SetupSchedulingFailure>

export const PreparationReason = z.enum([
  "analysis-window-limit",
  "empty-text-scope",
  "request-byte-limit",
  "capacity-unknown",
  "capacity-limit",
  "attempt-budget-limit",
  "unsupported-version",
])
export type PreparationReason = z.infer<typeof PreparationReason>
export const PreparationReview = z.object({
  purpose: AnalysisEvaluationPurpose.optional(),
  purposeTargetBound: z.boolean().optional(),
  state: z.enum(["ready", "blocked"]),
  reason: PreparationReason.nullable(),
  groupCount: z.number().int().nonnegative(),
  partCount: z.number().int().nonnegative(),
  unsentRanges: z.array(UnsentSourceRange).readonly().default([]),
  allowance: z.object({
    cap: z.number().int().nonnegative(),
    used: z.number().int().nonnegative(),
    remaining: z.number().int().nonnegative(),
    plannedAttempts: z.number().int().nonnegative(),
    reservedLaterAttempts: z.number().int().nonnegative(),
    uncertainCounts: z.literal(true),
  }),
  verificationRoom: z
    .object({
      policy: z.literal(VERIFICATION_ROOM_PREPROCESSING_VERSION),
      targetBytes: z.literal(VERIFICATION_ROOM_BYTES),
      sampleOnly: z.literal(true),
    })
    .optional(),
  batchedMaximum: z
    .object({
      reserveId: z.string(),
      maxFindingBatches: z.number().int().positive(),
      maxVerificationJobs: z.number().int().positive(),
      maxAnalysisJobs: z.number().int().positive(),
      maxAnalysisAttempts: z.number().int().positive(),
      reservedLaterAttempts: z.union([z.literal(12), z.literal(0)]),
      maxTotalAttempts: z.number().int().positive(),
      outputFitGuaranteed: z.literal(false),
      refusalLimits: z.array(z.string()).readonly(),
    })
    .optional(),
})
export type PreparationReview = z.infer<typeof PreparationReview>
export function preparationBatchParams(value: NonNullable<PreparationReview["batchedMaximum"]>) {
  const {
    reserveId: _id,
    outputFitGuaranteed: _guarantee,
    refusalLimits: _limits,
    ...counts
  } = value
  return counts
}
export function preparationAllowanceParams(allowance: PreparationReview["allowance"]) {
  const { uncertainCounts: _uncertainCounts, ...params } = allowance
  return params
}
export function preparationReasonKey(reason: PreparationReason) {
  const keys = {
    "analysis-window-limit": "setup.refusal.windowLimit",
    "empty-text-scope": "setup.refusal.emptyScope",
    "request-byte-limit": "setup.refusal.requestLimit",
    "capacity-unknown": "setup.preparation.capacityUnknown",
    "capacity-limit": "setup.preparation.capacityLimit",
    "attempt-budget-limit": "setup.preparation.budgetLimit",
    "unsupported-version": "setup.preparation.versionUnsupported",
  } as const
  return keys[reason]
}

export function setupDecisionHeading(
  progress: SetupAnalysisProgress,
  failure: SetupSchedulingFailure | null = null,
): "setup.approved" | "setup.consentSavedTitle" {
  return !failure &&
    (progress === "queued" || progress === "questions-queued" || progress === "questions-ready")
    ? "setup.approved"
    : "setup.consentSavedTitle"
}
export function setupProgressUrl(setupId: string): string {
  return `/jobs?setup=${encodeURIComponent(setupId)}`
}
