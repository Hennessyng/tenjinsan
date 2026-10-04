import type { SourceSpan } from "@reading-studio/contracts"
import type { Storage } from "@reading-studio/storage"
import { ProviderError } from "./catalog.ts"

const spanKey = (span: SourceSpan) =>
  JSON.stringify([
    span.editionId,
    span.normalizationRevisionId,
    span.resourcePath,
    span.blockId,
    span.start,
    span.end,
  ])

export function selectedEvidence(storage: Storage, spans: readonly SourceSpan[]) {
  const citations = new Map<string, SourceSpan>()
  for (const span of spans) {
    const key = spanKey(span)
    const previous = citations.get(key)
    if (previous && JSON.stringify(previous) !== JSON.stringify(span))
      throw new ProviderError("input-limit")
    citations.set(key, span)
  }
  const numbered = [...citations.entries()].map(([key, span], index) => ({
    key,
    id: `ref-${index}`,
    span,
  }))
  const byBlock = new Map<string, { readonly span: SourceSpan; start: number; end: number }[]>()
  for (const entry of numbered) {
    const blockKey = JSON.stringify([
      entry.span.editionId,
      entry.span.normalizationRevisionId,
      entry.span.resourcePath,
      entry.span.blockId,
    ])
    const ranges = byBlock.get(blockKey) ?? []
    ranges.push({ span: entry.span, start: entry.span.start, end: entry.span.end })
    byBlock.set(blockKey, ranges)
  }
  const passages = []
  for (const ranges of byBlock.values()) {
    ranges.sort((left, right) => left.start - right.start || left.end - right.end)
    const merged: { readonly span: SourceSpan; start: number; end: number }[] = []
    for (const range of ranges) {
      const previous = merged.at(-1)
      if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end)
      else merged.push({ ...range })
    }
    for (const range of merged) {
      const normalization = storage.sources.getNormalization(range.span.normalizationRevisionId)
      const resource = normalization?.resources.find(
        (item) => item.path === range.span.resourcePath,
      )
      const block =
        resource?.status === "included"
          ? resource.blocks.find((item) => item.id === range.span.blockId)
          : undefined
      if (!block || normalization?.editionId !== range.span.editionId)
        throw new ProviderError("unauthorized")
      passages.push({
        resourcePath: range.span.resourcePath,
        blockId: range.span.blockId,
        start: range.start,
        end: range.end,
        text: block.text.slice(range.start, range.end),
      })
    }
  }
  return {
    citations: numbered.map(({ id, span }) => ({ id, span })),
    passages,
    reference: (span: SourceSpan): string => {
      const entry = numbered.find((item) => item.key === spanKey(span))
      if (!entry) throw new ProviderError("unauthorized")
      return entry.id
    },
  }
}
