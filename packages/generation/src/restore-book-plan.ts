import type { StudySetupRevision } from "@reading-studio/contracts"
import { ProviderError } from "@reading-studio/providers"
import type { SourceWindow } from "./book-map-output.ts"
import type { ChapterGroup } from "./whole-book-scope.ts"

export function restoreBookPlan(
  setup: StudySetupRevision,
  groups: readonly ChapterGroup[],
): readonly SourceWindow[] {
  const processing = setup.analysis.processing
  if (!processing?.plan) throw new ProviderError("analysis-incomplete")
  for (const group of groups)
    for (const block of group.ranges) {
      let cursor = block.start
      for (const range of processing.plan
        .filter((part) => part.groupId === group.id)
        .flatMap((part) => part.ranges)
        .filter(
          (range) => range.resourcePath === block.resourcePath && range.blockId === block.blockId,
        )) {
        if (range.start !== cursor || range.end <= range.start || range.end > block.end)
          throw new ProviderError("unauthorized")
        cursor = range.end
      }
      if (cursor !== block.end) throw new ProviderError("unauthorized")
    }
  let previousGroup = -1
  let previousBlock = -1
  return processing.plan.map((part) => {
    const groupIndex = groups.findIndex((group) => group.id === part.groupId)
    const group = groups[groupIndex]
    if (!group || groupIndex < previousGroup) throw new ProviderError("unauthorized")
    if (groupIndex !== previousGroup) previousBlock = -1
    previousGroup = groupIndex
    const ranges = part.ranges.map((range) => {
      const blockIndex = group.ranges.findIndex(
        (block) => block.resourcePath === range.resourcePath && block.blockId === range.blockId,
      )
      const block = group.ranges[blockIndex]
      if (!block || blockIndex < previousBlock) throw new ProviderError("unauthorized")
      previousBlock = blockIndex
      const text = block.text.slice(range.start, range.end)
      if (!text.isWellFormed()) throw new ProviderError("unauthorized")
      return { ...block, ...range, text }
    })
    const first = ranges[0]
    if (!first) throw new ProviderError("unauthorized")
    return {
      ...first,
      ranges,
      groupId: part.groupId,
      text: ranges.map((range) => range.text).join(""),
    }
  })
}
