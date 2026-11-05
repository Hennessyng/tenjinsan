import { z } from "zod"
import { Digest } from "./primitives.ts"

export const FullBookAcknowledgements = z
  .strictObject({
    readableAndDerived: z.literal(true),
    appBoundedNotProviderLimits: z.literal(true),
    coverageAndOmissions: z.literal(true),
    budgetAndUnknown: z.literal(true),
    runtimeBinding: Digest,
    recipientBinding: Digest,
    planBinding: Digest,
    omissionsHash: Digest,
    maxAttempts: z.number().int().positive(),
    priorSpent: z.number().int().nonnegative(),
    priorUnknown: z.number().int().nonnegative(),
    priorUsageUnknown: z.number().int().nonnegative(),
    priorHeld: z.number().int().nonnegative(),
    sourceVersion: z.number().int().nonnegative(),
    sourceCeiling: z.number().int().positive(),
    coverage: z.enum(["complete", "partial"]),
    omissionCount: z.number().int().nonnegative(),
  })
  .readonly()
export const FullBookConsentReview = FullBookAcknowledgements.unwrap()
  .extend({ reviewBinding: Digest })
  .readonly()
