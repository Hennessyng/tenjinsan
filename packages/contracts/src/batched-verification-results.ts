import { BatchedVerificationReceipt } from "./batched-verification.ts"
import { BatchedVerificationManifest } from "./batched-verification-manifest.ts"

export function batchedVerificationComplete(
  manifest: BatchedVerificationManifest,
  receipts: readonly BatchedVerificationReceipt[],
) {
  const parsed = BatchedVerificationManifest.safeParse(manifest)
  const parsedReceipts = BatchedVerificationReceipt.array().readonly().safeParse(receipts)
  if (!parsed.success || !parsedReceipts.success) return false
  const targets = parsed.data.targets
  if (
    targets.length === 0 ||
    receipts.length !== targets.length ||
    new Set(targets.map((target) => target.id)).size !== targets.length ||
    new Set(receipts.map((receipt) => receipt.targetId)).size !== receipts.length
  )
    return false
  return targets.every((target) => {
    const receipt = receipts.find((receipt) => receipt.targetId === target.id)
    if (!receipt) return false
    const output = receipt.output,
      ids = new Set(output.decisions.map((decision) => decision.id))
    if (
      ids.size !== target.findingIds.length ||
      output.decisions.length !== target.findingIds.length ||
      !target.findingIds.every((id) => ids.has(id))
    )
      return false
    if (target.kind === "map-omission") {
      if (output.mapCoverage?.verdict !== "none" || output.mapCoverage.sources.length !== 0)
        return false
    } else if (output.mapCoverage !== null) return false
    return output.decisions.every(
      (decision) =>
        decision.verdict === "supported" ||
        (target.kind === "window-findings" && decision.verdict === "not-addressed"),
    )
  })
}
