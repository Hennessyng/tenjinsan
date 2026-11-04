import type { NormalizationRevision } from "@reading-studio/contracts"
import { auditOriginalAssembly } from "./evaluator-evidence.ts"

export type RequiredPassage = {
  readonly id: string
  readonly resourcePath: string
  readonly blockId: string
  readonly start: number
  readonly end: number
  readonly text: string
}
export function auditRequiredPassages(input: {
  readonly normalization: NormalizationRevision
  readonly payload: unknown
  readonly required: readonly RequiredPassage[]
}) {
  const originals = auditOriginalAssembly({ ...input, required: [] })
  const blocks = input.normalization.resources.flatMap((resource) =>
    resource.status === "included"
      ? resource.blocks.map((block) => ({ resourcePath: resource.path, ...block }))
      : [],
  )
  const passageChecks = input.required.map((passage) => {
    const block = blocks.find(
      (item) => item.resourcePath === passage.resourcePath && item.id === passage.blockId,
    )
    if (
      !block ||
      !Number.isSafeInteger(passage.start) ||
      !Number.isSafeInteger(passage.end) ||
      passage.start < 0 ||
      passage.end <= passage.start ||
      passage.end > block.text.length ||
      block.text.slice(passage.start, passage.end) !== passage.text
    )
      throw new TypeError("authored-passage-reference-mismatch")
    const ranges = originals.loadedRangeIdentities
      .filter(
        (range) => range.resourcePath === passage.resourcePath && range.blockId === passage.blockId,
      )
      .toSorted((left, right) => left.start - right.start)
    let cursor = passage.start
    for (const range of ranges) {
      if (range.end <= cursor) continue
      if (range.start > cursor) break
      cursor = Math.max(cursor, range.end)
    }
    return { ...passage, loadedRanges: ranges, covered: cursor >= passage.end }
  })
  return {
    ...originals,
    passageChecks,
    missingPassages: passageChecks
      .filter((passage) => !passage.covered)
      .map((passage) => passage.id),
    semanticVerdict: "NOT ASSESSED" as const,
  }
}
