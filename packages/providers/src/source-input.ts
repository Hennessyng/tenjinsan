import { contentDigest, InputCoverage, type NormalizationRevision } from "@reading-studio/contracts"
import { z } from "zod"
import { ProviderReceipt } from "./adapter.ts"
import type { authorizeSource } from "./authorization.ts"
import { ProviderError } from "./catalog.ts"

type Blocks = ReturnType<typeof authorizeSource>["blocks"]

export { InputCoverage } from "@reading-studio/contracts"
export const RecordedProviderReceipt = z.union([
  ProviderReceipt.options[0].extend({ inputCoverage: InputCoverage.optional() }),
  ProviderReceipt.options[1].extend({ inputCoverage: InputCoverage.optional() }),
])
export type RecordedProviderReceipt = z.infer<typeof RecordedProviderReceipt>

export function sourceInput(
  approved: Blocks,
  window?: { readonly blockId: string; readonly start: number; readonly end: number },
): Blocks {
  if (!window) return approved
  const block = approved.find((block) => block.blockId === window.blockId)
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
    const sent = input.sent.find((sent) => sent.blockId === block.blockId)
    if (!sent) return [range(block)]
    return [
      ...(sent.start > block.start ? [{ ...range(block), end: sent.start }] : []),
      ...(sent.end < block.end ? [{ ...range(block), start: sent.end }] : []),
    ]
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
