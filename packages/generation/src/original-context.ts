import { LocatedSourceSpan, type MappedFinding } from "@reading-studio/contracts"
import { ProviderError } from "@reading-studio/providers"
import type { WholeBookContext } from "./whole-book-context.ts"

export function originalContext(
  context: Pick<WholeBookContext, "normalization" | "approved">,
  findings: readonly MappedFinding[],
) {
  const requested: { readonly index: number; readonly start: number; readonly end: number }[] = []
  for (const finding of findings)
    for (const span of finding.sources) {
      if (!LocatedSourceSpan.safeParse({ normalization: context.normalization, span }).success)
        throw new ProviderError("unauthorized")
      const index = context.approved.findIndex(
        (block) => block.resourcePath === span.resourcePath && block.blockId === span.blockId,
      )
      const block = context.approved[index]
      if (
        !block ||
        block.text.slice(span.start, span.end) !== span.originalFragment ||
        block.pageLabel !== span.pageLabel
      )
        throw new ProviderError("unauthorized")
      requested.push({
        index,
        start: Math.max(0, span.start - 512),
        end: Math.min(block.end, span.end + 512),
      })
      const previous = context.approved[index - 1]
      const next = context.approved[index + 1]
      if (previous)
        requested.push({
          index: index - 1,
          start: Math.max(0, previous.end - 512),
          end: previous.end,
        })
      if (next) requested.push({ index: index + 1, start: 0, end: Math.min(next.end, 512) })
    }
  const merged: { index: number; start: number; end: number }[] = []
  for (const range of requested.sort((a, b) => a.index - b.index || a.start - b.start)) {
    const previous = merged.at(-1)
    if (previous?.index === range.index && range.start <= previous.end)
      previous.end = Math.max(previous.end, range.end)
    else merged.push({ ...range })
  }
  return merged.flatMap((range) => {
    const block = context.approved[range.index]
    if (!block || range.end <= range.start) return []
    let { start, end } = range
    const first = block.text.charCodeAt(start)
    const last = block.text.charCodeAt(end - 1)
    if (first >= 0xdc00 && first <= 0xdfff) start--
    if (last >= 0xd800 && last <= 0xdbff) end++
    return [{ resourcePath: block.resourcePath, blockId: block.blockId, start, end }]
  })
}
