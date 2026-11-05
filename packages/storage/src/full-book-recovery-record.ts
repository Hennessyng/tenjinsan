import { Digest, Timestamp } from "@reading-studio/contracts"
import { z } from "zod"
export const RECOVERY_LOGGING_BINDING =
  "05c1bec3c9d1ce75ce5f00ee01b388434fad7cd9c1ecf1fa31f292065be7fc9c" as const
export const FullBookRecoveryAmendment = z
  .strictObject({
    version: z.literal("first-map-recovery-1"),
    id: z.uuid(),
    nativeConsentId: z.uuid(),
    budgetConsentId: z.uuid(),
    jobId: Digest,
    runId: z.string().regex(/^fb-[a-f0-9]{64}$/u),
    priorAttemptIds: z.tuple([z.uuid(), z.uuid()]).readonly(),
    ordinal: z.literal(3),
    extraHold: z.literal(1),
    originalCeiling: z.number().int().positive(),
    effectiveCeiling: z.number().int().positive(),
    nativeBinding: Digest,
    budgetBinding: Digest,
    scopeBinding: Digest,
    loggingVersion: z.literal("protocol54-45-sites"),
    loggingBinding: z.literal(RECOVERY_LOGGING_BINDING),
    stopAfterResult: z.literal(true),
    ownerDecision: z.literal("raise-ceiling-one-first-map-attempt"),
    approvedAt: Timestamp,
  })
  .refine(
    (record) => record.effectiveCeiling === record.originalCeiling + 1,
    "exactly one additional held slot",
  )
  .readonly()
export type FullBookRecoveryAmendment = z.infer<typeof FullBookRecoveryAmendment>
