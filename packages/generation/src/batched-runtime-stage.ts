import {
  type BatchedVerificationManifest,
  type BatchedVerificationTarget,
  CoverageVerificationOutput,
  chapterFindings,
  contentDigest,
  type MappedFinding,
  synthesisFindings,
} from "@reading-studio/contracts"
import type { StructuredStage } from "@reading-studio/providers"
import { batchVerificationRequest } from "./batched-verification-request.ts"
import type { WholeBookContext } from "./whole-book-context.ts"

export function batchedOutputSchema(target: BatchedVerificationTarget) {
  return CoverageVerificationOutput.superRefine((value, ctx) => {
    const ids = new Set(value.decisions.map((decision) => decision.id))
    if (
      ids.size !== target.findingIds.length ||
      value.decisions.length !== target.findingIds.length ||
      !target.findingIds.every((id) => ids.has(id))
    )
      ctx.addIssue({ code: "custom", message: "foreign/missing batched verdict" })
    if (target.kind === "map-omission") {
      if (!value.mapCoverage)
        ctx.addIssue({ code: "custom", message: "missing map omission review" })
      if (value.mapCoverage?.verdict === "none" && value.mapCoverage.sources.length > 0)
        ctx.addIssue({ code: "custom", message: "contradictory omission evidence" })
      if (
        value.mapCoverage?.verdict === "material-omission" &&
        value.mapCoverage.sources.length === 0
      )
        ctx.addIssue({ code: "custom", message: "missing omission evidence" })
      for (const span of value.mapCoverage?.sources ?? [])
        if (
          span.end <= span.start ||
          !target.originals.some(
            (original) =>
              original.resourcePath === span.resourcePath &&
              original.blockId === span.blockId &&
              span.start >= original.start &&
              span.end <= original.end,
          )
        )
          ctx.addIssue({ code: "custom", message: "foreign omission evidence" })
    } else if (value.mapCoverage !== null)
      ctx.addIssue({ code: "custom", message: "unexpected map review on finding batch" })
  })
}
export function batchedRuntimeStage(
  context: WholeBookContext,
  manifest: BatchedVerificationManifest,
  index: number,
): StructuredStage {
  const target = manifest.targets[index]
  if (!target) throw new TypeError("Foreign batch index")
  const windowIndex = manifest.reserve.windowHashes.indexOf(
    target.windowHash ?? manifest.reserve.id,
  )
  const map = target.kind === "map-omission" ? manifest.maps[windowIndex] : undefined
  const findings: readonly MappedFinding[] = map
    ? chapterFindings(map)
    : target.findingIds.map((id) => {
        const found = synthesisFindings(manifest.synthesis).find((finding) => finding.id === id)
        if (!found) throw new TypeError("Foreign batch finding")
        return found
      })
  const request = batchVerificationRequest(
    { setup: context.setup, normalization: context.normalization, capacity: context.capacity },
    { target, findings, ...(map ? { map } : {}) },
  )
  const boundary = request.prompt.lastIndexOf("\n")
  const blocks: unknown = JSON.parse(request.prompt.slice(boundary + 1))
  if (!Array.isArray(blocks)) throw new TypeError("Invalid batch request")
  return {
    instruction: request.prompt.slice(0, boundary),
    schema: batchedOutputSchema(target),
    processingStep: "original-verification",
    sourceRanges: target.originals,
    derivedData: blocks.slice(0, 1),
    capacity: context.capacity,
    batchTarget: target,
    batchManifestHash: contentDigest(JSON.stringify(manifest)),
  }
}
