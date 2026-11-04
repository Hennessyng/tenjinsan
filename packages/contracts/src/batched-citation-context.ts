import type { MappedFinding } from "./book-map-model.ts"
import { WindowOriginal } from "./coverage-verification.ts"

export function batchedCitationContext(
  catalog: readonly WindowOriginal[],
  findings: readonly MappedFinding[],
) {
  const requested: { index: number; start: number; end: number }[] = []
  for (const finding of findings)
    for (const span of finding.sources) {
      const index = catalog.findIndex(
        (block) => block.resourcePath === span.resourcePath && block.blockId === span.blockId,
      )
      const block = catalog[index]
      if (
        !block ||
        span.editionId !== block.editionId ||
        span.normalizationRevisionId !== block.normalizationRevisionId ||
        span.start < block.start ||
        span.end > block.end ||
        span.pageLabel !== block.pageLabel ||
        block.originalFragment.slice(span.start - block.start, span.end - block.start) !==
          span.originalFragment
      )
        throw new TypeError("Foreign original citation")
      requested.push({
        index,
        start: Math.max(block.start, span.start - 512),
        end: Math.min(block.end, span.end + 512),
      })
      const previous = catalog[index - 1],
        next = catalog[index + 1]
      if (previous)
        requested.push({
          index: index - 1,
          start: Math.max(previous.start, previous.end - 512),
          end: previous.end,
        })
      if (next)
        requested.push({
          index: index + 1,
          start: next.start,
          end: Math.min(next.end, next.start + 512),
        })
    }
  const merged: typeof requested = []
  for (const range of requested.sort((a, b) => a.index - b.index || a.start - b.start)) {
    const previous = merged.at(-1)
    if (previous?.index === range.index && range.start <= previous.end)
      previous.end = Math.max(previous.end, range.end)
    else merged.push({ ...range })
  }
  return merged.map((range) => {
    const block = catalog[range.index]
    if (!block) throw new TypeError("Foreign context index")
    let { start, end } = range
    const first = block.originalFragment.charCodeAt(start - block.start),
      last = block.originalFragment.charCodeAt(end - block.start - 1)
    if (first >= 0xdc00 && first <= 0xdfff) start--
    if (last >= 0xd800 && last <= 0xdbff) end++
    return WindowOriginal.parse({
      ...block,
      start,
      end,
      originalFragment: block.originalFragment.slice(start - block.start, end - block.start),
    })
  })
}
