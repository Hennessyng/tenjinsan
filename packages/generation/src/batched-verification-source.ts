import {
  batchedCitationContext,
  type MappedFinding,
  WindowOriginal,
} from "@reading-studio/contracts"
import { reviewedSourceBlocks } from "@reading-studio/providers"
import type { BatchExecution } from "./batched-verification-request.ts"

export function batchSources(execution: BatchExecution) {
  return reviewedSourceBlocks(execution.setup, execution.normalization)
}
export function batchOriginals(execution: BatchExecution) {
  return batchSources(execution)
    .filter((block) => block.end > block.start)
    .map((block) =>
      WindowOriginal.parse({
        editionId: execution.setup.editionId,
        normalizationRevisionId: execution.normalization.id,
        resourcePath: block.resourcePath,
        blockId: block.blockId,
        start: block.start,
        end: block.end,
        originalFragment: block.text,
        ...(block.pageLabel ? { pageLabel: block.pageLabel } : {}),
      }),
    )
}
export function validBatchPartition(
  source: readonly WindowOriginal[],
  windows: readonly (readonly WindowOriginal[])[],
) {
  if (source.length === 0 || windows.length === 0 || windows.some((window) => window.length === 0))
    return false
  let index = 0,
    cursor = source[0]?.start ?? 0
  for (const span of windows.flat()) {
    const block = source[index]
    if (
      !WindowOriginal.safeParse(span).success ||
      !block ||
      span.resourcePath !== block.resourcePath ||
      span.blockId !== block.blockId ||
      span.editionId !== block.editionId ||
      span.normalizationRevisionId !== block.normalizationRevisionId ||
      span.pageLabel !== block.pageLabel ||
      span.start !== cursor ||
      span.end > block.end ||
      block.originalFragment.slice(span.start - block.start, span.end - block.start) !==
        span.originalFragment
    )
      return false
    cursor = span.end
    if (cursor === block.end) {
      index++
      cursor = source[index]?.start ?? 0
    }
  }
  return index === source.length
}
export function citationOriginals(execution: BatchExecution, findings: readonly MappedFinding[]) {
  return batchedCitationContext(batchOriginals(execution), findings)
}
