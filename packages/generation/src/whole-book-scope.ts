import {
  contentDigest,
  type NormalizationRevision,
  type StudySetupRevision,
} from "@reading-studio/contracts"
import { reviewedSourceBlocks } from "@reading-studio/providers"
import type { SourceWindow } from "./book-map-output.ts"

export const WHOLE_BOOK_VERSION = "whole-book-2"
export type ChapterGroup = {
  readonly id: string
  readonly title: string
  readonly provenance: "heading" | "structural"
  readonly level: number | null
  readonly parentId: string | null
  readonly ranges: readonly SourceWindow[]
}
export function groupMetadata(group: ChapterGroup) {
  const { id, title, provenance, level, parentId } = group
  return { id, title, provenance, level, parentId }
}

export function wholeBookGroups(
  setup: StudySetupRevision,
  normalization: NormalizationRevision,
): readonly ChapterGroup[] {
  const groups: ChapterGroup[] = []
  const ancestors: { readonly id: string; readonly level: number }[] = []
  for (const block of reviewedSourceBlocks(setup, normalization)) {
    const prefix =
      block.heading &&
      groups.at(-1)?.provenance === "structural" &&
      groups.at(-1)?.ranges.every((range) => range.text.length === 0)
        ? (groups.pop()?.ranges ?? [])
        : []
    if (block.heading || groups.length === 0) {
      const level = block.heading ?? null
      if (level !== null) while ((ancestors.at(-1)?.level ?? 0) >= level) ancestors.pop()
      const id = `group-${contentDigest(JSON.stringify([normalization.id, block.resourcePath, block.blockId]))}`
      groups.push({
        id,
        title: level === null ? "Unheaded structural group" : block.text,
        provenance: level === null ? "structural" : "heading",
        level,
        parentId: level === null ? null : (ancestors.at(-1)?.id ?? null),
        ranges: prefix,
      })
      if (level !== null) ancestors.push({ id, level })
    }
    const current = groups.at(-1)
    if (!current) throw new TypeError("Missing structural group")
    const { resourcePath, blockId, start, end, text, pageLabel, heading, structure } = block
    groups[groups.length - 1] = {
      ...current,
      ranges: [
        ...current.ranges,
        {
          resourcePath,
          blockId,
          start,
          end,
          text,
          ...(pageLabel ? { pageLabel } : {}),
          ...(heading ? { heading } : {}),
          ...(structure ? { structure } : {}),
        },
      ],
    }
  }
  return groups
}

export function splitSource(range: SourceWindow, limit: number): readonly SourceWindow[] {
  const parts: SourceWindow[] = []
  let start = range.start
  while (start < range.end) {
    let end = Math.min(start + limit, range.end)
    const unit = range.text.charCodeAt(end - range.start - 1)
    if (end < range.end && unit >= 0xd800 && unit <= 0xdbff) end--
    if (end <= start) throw new TypeError("Source part limit must fit a Unicode scalar")
    parts.push({
      ...range,
      start,
      end,
      text: range.text.slice(start - range.start, end - range.start),
    })
    start = end
  }
  return parts
}

export function packGroups(
  groups: readonly ChapterGroup[],
  limit = 16000,
): readonly SourceWindow[] {
  const windows: SourceWindow[] = []
  for (const group of groups) {
    let pending: SourceWindow[] = []
    let size = 0
    const flush = () => {
      const first = pending[0]
      if (first)
        windows.push({
          ...first,
          text: pending.map((range) => range.text).join(""),
          ranges: pending,
          groupId: group.id,
        })
      pending = []
      size = 0
    }
    for (const range of group.ranges) {
      for (const part of splitSource(range, 4000)) {
        const cost = Buffer.byteLength(JSON.stringify(part), "utf8")
        if (pending.length > 0 && size + cost > limit) flush()
        pending.push(part)
        size += cost
      }
    }
    flush()
  }
  return windows
}
