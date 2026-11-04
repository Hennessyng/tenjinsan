import { z } from "zod"
import { AnalysisEvaluationPurpose } from "./analysis-purpose.ts"
import { CoverageVerificationOutput, WindowOriginal } from "./coverage-verification.ts"
import { contentDigest } from "./identity.ts"
import { ContentId, Digest, Natural } from "./primitives.ts"

export const BATCHED_VERIFICATION_VERSION = "batched-original-check-4" as const
const Positive = Natural.refine((value) => value > 0)
const ReserveBody = z.strictObject({
  version: z.literal(BATCHED_VERIFICATION_VERSION),
  analysisKey: Digest,
  capacityId: z.string().min(1),
  sourceHash: Digest,
  windowHashes: z.array(Digest).min(1).max(128).readonly(),
  maxFindingBatches: Positive,
  maxVerificationJobs: Positive,
  maxAnalysisJobs: Positive,
  plannedAttempts: Positive,
  cap: z.number().int().positive().max(64),
  used: Natural,
  attemptsPerJob: z.literal(2),
  reservedLaterAttempts: z.literal(12),
  outputFitGuaranteed: z.literal(false),
})
export const AnalysisEvaluationReserveBody = ReserveBody.extend({
  reservedLaterAttempts: z.literal(0),
  cap: z.number().int().positive().max(20),
  purpose: AnalysisEvaluationPurpose,
  budgetPolicy: z.literal("analysis-evaluation-reserve-1"),
})
const signed = <T extends typeof ReserveBody | typeof AnalysisEvaluationReserveBody>(schema: T) =>
  schema
    .extend({ id: Digest })
    .superRefine((value, ctx) => {
      const { id, ...body } = value
      const windows = value.windowHashes.length
      if (
        contentDigest(JSON.stringify(body)) !== id ||
        new Set(value.windowHashes).size !== windows ||
        value.maxVerificationJobs !== windows + (windows + 1) * value.maxFindingBatches ||
        value.maxAnalysisJobs !== windows + 1 + value.maxVerificationJobs ||
        value.plannedAttempts !== value.maxAnalysisJobs * 2 + value.reservedLaterAttempts ||
        value.plannedAttempts > value.cap - value.used
      )
        ctx.addIssue({ code: "custom", message: "invalid signed batch reserve" })
    })
    .readonly()
export const BatchedVerificationReserve = z.union([
  signed(ReserveBody),
  signed(AnalysisEvaluationReserveBody),
])
export type BatchedVerificationReserve = z.infer<typeof BatchedVerificationReserve>

export const BatchedVerificationTarget = z
  .strictObject({
    id: Digest,
    planId: Digest,
    kind: z.enum(["map-omission", "window-findings", "synthesis-citations"]),
    windowHash: Digest.nullable(),
    batchHash: Digest.nullable(),
    sourceHash: Digest,
    mapsHash: Digest,
    synthesisHash: Digest,
    findingsHash: Digest,
    findingIds: z.array(ContentId).readonly(),
    originals: z.array(WindowOriginal).min(1).readonly(),
  })
  .superRefine((value, ctx) => {
    const { id, ...body } = value
    if (
      contentDigest(JSON.stringify(body)) !== id ||
      new Set(value.findingIds).size !== value.findingIds.length ||
      (value.kind === "map-omission"
        ? value.windowHash === null || value.batchHash !== null
        : value.batchHash === null) ||
      (value.kind === "window-findings" && value.windowHash === null) ||
      (value.kind === "synthesis-citations" && value.windowHash !== null)
    )
      ctx.addIssue({ code: "custom", message: "invalid batch target identity" })
  })
  .readonly()
export type BatchedVerificationTarget = z.infer<typeof BatchedVerificationTarget>

export const BatchedVerificationReceipt = z
  .strictObject({ targetId: Digest, output: CoverageVerificationOutput })
  .readonly()
export type BatchedVerificationReceipt = z.infer<typeof BatchedVerificationReceipt>
