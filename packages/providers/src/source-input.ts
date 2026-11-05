import {
  BatchedVerificationTarget,
  CoverageVerificationTarget,
  contentDigest,
  Digest,
  InputCoverage,
  type NormalizationRevision,
} from "@reading-studio/contracts"
import { z } from "zod"
import { ProviderReceipt } from "./adapter.ts"
import type { authorizeSource } from "./authorization.ts"
import { ProviderError } from "./catalog.ts"

type Blocks = ReturnType<typeof authorizeSource>["blocks"]

export { InputCoverage } from "@reading-studio/contracts"

const processingMetadata = {
  inputCoverage: InputCoverage.optional(),
  processingStrategy: z.enum(["complete-maps", "complete-maps-and-original"]).optional(),
  processingStep: z.enum(["chapter-map", "book-synthesis", "original-verification"]).optional(),
  verificationTarget: CoverageVerificationTarget.optional(),
  batchTarget: BatchedVerificationTarget.optional(),
  batchManifestHash: Digest.optional(),
}
export const RecordedProviderReceipt = z.union([
  ProviderReceipt.options[0].extend(processingMetadata),
  ProviderReceipt.options[1].extend(processingMetadata),
])
export type RecordedProviderReceipt = z.infer<typeof RecordedProviderReceipt>

export function sourceInput(
  approved: Blocks,
  window?: {
    readonly blockId: string
    readonly start: number
    readonly end: number
    readonly resourcePath?: string
    readonly ranges?: readonly {
      readonly resourcePath: string
      readonly blockId: string
      readonly start: number
      readonly end: number
    }[]
  },
): Blocks {
  if (!window) return approved
  if (window.ranges) return sourceRangesInput(approved, window.ranges)
  const block = approved.find(
    (block) =>
      block.blockId === window.blockId &&
      (!window.resourcePath || block.resourcePath === window.resourcePath),
  )
  if (
    !block ||
    !Number.isInteger(window.start) ||
    !Number.isInteger(window.end) ||
    window.start < 0 ||
    window.end <= window.start ||
    window.end > block.text.length
  )
    throw new ProviderError("input-limit")
  return [
    {
      ...block,
      text: block.text.slice(window.start, window.end),
      start: window.start,
      end: window.end,
    },
  ]
}
export function bookSourcePayload(blocks: Blocks) {
  return blocks.map(
    ({ resourcePath, blockId, start, end, text, locator, pageLabel, heading, structure }) => ({
      resourcePath,
      blockId,
      start,
      end,
      text,
      ...(locator ? { locator } : {}),
      ...(pageLabel ? { pageLabel } : {}),
      ...(heading ? { heading } : {}),
      ...(structure ? { structure } : {}),
    }),
  )
}
export function sourceRangesInput(
  approved: Blocks,
  ranges: readonly {
    readonly resourcePath: string
    readonly blockId: string
    readonly start: number
    readonly end: number
  }[],
): Blocks {
  const sent: Blocks = ranges.flatMap((range) => sourceInput(approved, range))
  for (const [index, range] of sent.entries())
    if (
      sent
        .slice(0, index)
        .some(
          (earlier) =>
            earlier.blockId === range.blockId &&
            earlier.resourcePath === range.resourcePath &&
            earlier.start < range.end &&
            range.start < earlier.end,
        )
    )
      throw new ProviderError("input-limit")
  return sent
}
export function inputCoverage(input: {
  readonly normalization: NormalizationRevision
  readonly approved: Blocks
  readonly sent: Blocks
  readonly prompt: string
}) {
  const range = ({ resourcePath, blockId, start, end }: Blocks[number]) => ({
    resourcePath,
    blockId,
    start,
    end,
  })
  const untransmittedRanges = input.approved.flatMap((block) => {
    const sent = input.sent
      .filter((sent) => sent.blockId === block.blockId && sent.resourcePath === block.resourcePath)
      .sort((a, b) => a.start - b.start)
    const missing = []
    let cursor = block.start
    for (const part of sent) {
      if (part.start > cursor) missing.push({ ...range(block), start: cursor, end: part.start })
      cursor = Math.max(cursor, part.end)
    }
    if (cursor < block.end) missing.push({ ...range(block), start: cursor })
    return missing
  })
  return InputCoverage.parse({
    extraction: input.normalization.coverage,
    transmission:
      input.sent.length === input.approved.length &&
      input.sent.every(
        (block, index) =>
          block.start === input.approved[index]?.start && block.end === input.approved[index]?.end,
      )
        ? "reviewed-scope"
        : "window-only",
    processing: "not-established",
    requestHash: contentDigest(input.prompt),
    ranges: input.sent.map(range),
    reviewedRanges: input.approved.map(range),
    untransmittedRanges,
    omissions:
      input.normalization.omissions ??
      input.normalization.resources.flatMap((resource) =>
        resource.status === "excluded" ? [{ path: resource.path, reason: resource.reason }] : [],
      ),
  })
}
