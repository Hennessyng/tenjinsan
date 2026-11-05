import { z } from "zod"
import { BatchedVerificationReceipt, BatchedVerificationReserve } from "./batched-verification.ts"
import { BatchedVerificationManifest } from "./batched-verification-manifest.ts"
import { contentDigest } from "./identity.ts"
import { Digest, GrantId, SetupRevisionId } from "./primitives.ts"

export const BatchedVerificationState = z
  .strictObject({
    setupId: SetupRevisionId,
    grantId: GrantId,
    reserve: BatchedVerificationReserve,
    manifest: BatchedVerificationManifest.nullable(),
    manifestHash: Digest.nullable(),
    receipts: z.array(BatchedVerificationReceipt).readonly(),
  })
  .superRefine((value, ctx) => {
    const invalid = () =>
      ctx.addIssue({ code: "custom", message: "foreign or reordered batched state" })
    if (!value.manifest) {
      if (value.manifestHash !== null || value.receipts.length !== 0) invalid()
      return
    }
    if (
      contentDigest(JSON.stringify(value.manifest)) !== value.manifestHash ||
      JSON.stringify(value.manifest.reserve) !== JSON.stringify(value.reserve)
    )
      invalid()
    let previous = -1
    for (const receipt of value.receipts) {
      const index = value.manifest.targets.findIndex((target) => target.id === receipt.targetId)
      const target = value.manifest.targets[index]
      if (index <= previous || !target) {
        invalid()
        continue
      }
      previous = index
      const ids = new Set(receipt.output.decisions.map((decision) => decision.id))
      if (
        ids.size !== target.findingIds.length ||
        receipt.output.decisions.length !== target.findingIds.length ||
        !target.findingIds.every((id) => ids.has(id))
      )
        invalid()
    }
  })
  .readonly()
export type BatchedVerificationState = z.infer<typeof BatchedVerificationState>
