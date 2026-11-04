import { WindowOriginal } from "./coverage-verification.ts"
import { contentDigest } from "./identity.ts"
import type { StudySetupRevision } from "./lineage.ts"
import type { NormalizationRevision } from "./source.ts"
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
export function batchedSourceCatalog(
  setup: StudySetupRevision,
  normalization: NormalizationRevision,
) {
  if (
    normalization.id !== setup.analysis.normalizationRevisionId ||
    normalization.editionId !== setup.editionId ||
    normalization.editionHash !== setup.analysis.editionHash
  )
    throw new TypeError("Missing authoritative batched setup source")
  return setup.analysis.scope.selected.flatMap((selection) => {
    const resource = normalization.resources.find(
      (resource) => resource.path === selection.resourcePath,
    )
    if (resource?.status !== "included") throw new TypeError("Foreign selected source")
    return selection.blockIds.flatMap((id) => {
      const block = resource.blocks.find((block) => block.id === id)
      if (!block) throw new TypeError("Foreign selected block")
      return block.text.length === 0
        ? []
        : [
            WindowOriginal.parse({
              editionId: setup.editionId,
              normalizationRevisionId: normalization.id,
              resourcePath: resource.path,
              blockId: block.id,
              start: 0,
              end: block.text.length,
              originalFragment: block.text,
              ...(block.pageLabel ? { pageLabel: block.pageLabel } : {}),
            }),
          ]
    })
  })
}
export function validatedBatchedSetupSources(
  setup: StudySetupRevision,
  normalization: NormalizationRevision,
) {
  const reserve = setup.batchedVerificationReserve,
    plan = setup.analysis.processing?.plan
  if (!reserve || !plan) throw new TypeError("Missing signed source plan")
  const originals = batchedSourceCatalog(setup, normalization)
  const windows = plan.map((part) =>
    part.ranges.map((range) => {
      const source = originals.find(
        (source) => source.resourcePath === range.resourcePath && source.blockId === range.blockId,
      )
      if (!source) throw new TypeError("Foreign planned source")
      return WindowOriginal.parse({
        ...source,
        start: range.start,
        end: range.end,
        originalFragment: source.originalFragment.slice(range.start, range.end),
      })
    }),
  )
  if (
    !validBatchPartition(originals, windows) ||
    contentDigest(JSON.stringify(originals)) !== reserve.sourceHash ||
    JSON.stringify(windows.map((window) => contentDigest(JSON.stringify(window)))) !==
      JSON.stringify(reserve.windowHashes)
  )
    throw new TypeError("Foreign source partition or reserve")
  return windows
}
