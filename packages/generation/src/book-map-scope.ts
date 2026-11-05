import {
  type NormalizationRevision,
  NormalizedStudySetup,
  SourcePreparationFailure,
  type StudySetupRevision,
  wholeBookScope,
} from "@reading-studio/contracts"
import { ProviderError } from "@reading-studio/providers"
import type { SourceWindow } from "./book-map-output.ts"
import { restoreBookPlan } from "./restore-book-plan.ts"
import {
  type ChapterGroup,
  packGroups,
  WHOLE_BOOK_VERSION,
  wholeBookGroups,
} from "./whole-book-scope.ts"

export const WINDOW_CHARACTERS = 12_000
const MAX_WINDOWS = 128

export function prepareBookMapScope(
  setup: StudySetupRevision,
  normalization: NormalizationRevision,
):
  | {
      readonly kind: "ready"
      readonly windows: readonly SourceWindow[]
      readonly groups?: readonly ChapterGroup[]
    }
  | { readonly kind: "limited"; readonly failure: SourcePreparationFailure } {
  const linked = NormalizedStudySetup.safeParse({ setup, normalization })
  if (!linked.success) throw new ProviderError("unauthorized")
  if (setup.analysis.analysisPromptVersion === WHOLE_BOOK_VERSION) {
    if (JSON.stringify(setup.analysis.scope) !== JSON.stringify(wholeBookScope(normalization)))
      throw new ProviderError("unauthorized")
    const groups = wholeBookGroups(setup, normalization)
    if (
      setup.analysis.processing?.preprocessingVersion === "packed-capacity-3" ||
      setup.analysis.processing?.preprocessingVersion === "batched-capacity-4" ||
      setup.analysis.processing?.preprocessingVersion === "batched-room-5"
    ) {
      const windows = setup.analysis.processing.plan
        ? restoreBookPlan(setup, groups)
        : groups.flatMap((group) => {
            const ranges = group.ranges.filter((range) => range.text.length > 0)
            const first = ranges[0]
            return first
              ? [
                  {
                    ...first,
                    ranges,
                    groupId: group.id,
                    text: ranges.map((range) => range.text).join(""),
                  },
                ]
              : []
          })
      if (windows.length > 0) return { kind: "ready", windows, groups }
    }
    const windows = packGroups(groups)
    if (windows.length > 0 && windows.length <= MAX_WINDOWS)
      return { kind: "ready", groups, windows }
    return {
      kind: "limited",
      failure: SourcePreparationFailure.parse({
        error: "scope-limit",
        coverage: {
          transmission: "not-sent",
          reason: windows.length === 0 ? "empty-text-scope" : "analysis-window-limit",
          requiredWindows: windows.length,
          maxWindows: MAX_WINDOWS,
          unsentRanges: groups.flatMap((group) =>
            group.ranges.map(({ resourcePath, blockId, start, end }) => ({
              resourcePath,
              blockId,
              start,
              end,
            })),
          ),
        },
      }),
    }
  }
  const blocks = setup.analysis.scope.selected.flatMap((selection) => {
    const resource = normalization.resources.find(
      (resource) => resource.path === selection.resourcePath,
    )
    if (resource?.status !== "included") throw new ProviderError("unauthorized")
    return selection.blockIds.map((id) => {
      const block = resource.blocks.find((block) => block.id === id)
      if (!block) throw new ProviderError("unauthorized")
      return { ...block, resourcePath: resource.path }
    })
  })
  const requiredWindows = blocks.reduce(
    (sum, block) => sum + Math.ceil(block.text.length / WINDOW_CHARACTERS),
    0,
  )
  if (requiredWindows === 0 || requiredWindows > MAX_WINDOWS)
    return {
      kind: "limited",
      failure: SourcePreparationFailure.parse({
        error: "scope-limit",
        coverage: {
          transmission: "not-sent",
          reason: requiredWindows === 0 ? "empty-text-scope" : "analysis-window-limit",
          requiredWindows,
          maxWindows: MAX_WINDOWS,
          unsentRanges: blocks.map((block) => ({
            resourcePath: block.resourcePath,
            blockId: block.id,
            start: 0,
            end: block.text.length,
            ...(block.locator ? { locator: block.locator } : {}),
            ...(block.pageLabel ? { pageLabel: block.pageLabel } : {}),
            ...(block.originalFragment ? { originalFragment: block.originalFragment } : {}),
          })),
        },
      }),
    }
  const windows: SourceWindow[] = []
  for (const block of blocks)
    for (let start = 0; start < block.text.length; start += WINDOW_CHARACTERS) {
      windows.push({
        resourcePath: block.resourcePath,
        blockId: block.id,
        start,
        end: Math.min(start + WINDOW_CHARACTERS, block.text.length),
        text: block.text.slice(start, start + WINDOW_CHARACTERS),
        ...(block.pageLabel ? { pageLabel: block.pageLabel } : {}),
      })
    }
  return { kind: "ready", windows }
}
