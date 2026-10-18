import {
  type NormalizationRevision,
  NormalizedStudySetup,
  SourcePreparationFailure,
  type StudySetupRevision,
} from "@reading-studio/contracts"
import { ProviderError } from "@reading-studio/providers"
import type { SourceWindow } from "./book-map-output.ts"

export const WINDOW_CHARACTERS = 12_000
const MAX_WINDOWS = 128

export function prepareBookMapScope(
  setup: StudySetupRevision,
  normalization: NormalizationRevision,
):
  | { readonly kind: "ready"; readonly windows: readonly SourceWindow[] }
  | { readonly kind: "limited"; readonly failure: SourcePreparationFailure } {
  const linked = NormalizedStudySetup.safeParse({ setup, normalization })
  if (!linked.success) throw new ProviderError("unauthorized")
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
