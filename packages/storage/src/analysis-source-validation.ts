import {
  type AnalysisRevision,
  assertNever,
  chapterFindings,
  LocatedSourceSpan,
  type NormalizationRevision,
  synthesisFindings,
} from "@reading-studio/contracts"
import { ContractBoundaryError } from "./errors.ts"
import { parseInput } from "./records.ts"

export function validateAnalysisSources(
  record: AnalysisRevision,
  normalization: NormalizationRevision,
) {
  const rich = record.wholeBook
  if (rich) {
    const expected = record.cacheInput.scope.selected.flatMap((selection) => {
      const resource = normalization.resources.find(
        (resource) => resource.path === selection.resourcePath,
      )
      return selection.blockIds.map((id) => {
        const block =
          resource?.status === "included"
            ? resource.blocks.find((block) => block.id === id)
            : undefined
        if (!block) throw new ContractBoundaryError("prepared source identity")
        return {
          resourcePath: selection.resourcePath,
          blockId: id,
          start: 0,
          end: block.text.length,
        }
      })
    })
    if (JSON.stringify(expected) !== JSON.stringify(rich.groups.flatMap((group) => group.ranges)))
      throw new ContractBoundaryError("prepared source coverage")
    const plan = record.cacheInput.processing?.plan
    if (
      plan &&
      JSON.stringify(plan) !==
        JSON.stringify(rich.parts.map(({ groupId, ranges }) => ({ groupId, ranges })))
    )
      throw new ContractBoundaryError("prepared source plan")
  }
  const verifiedOriginals =
    rich?.verification.flatMap((check) => {
      const target = check.coverage?.target
      if (!target) return []
      switch (target.kind) {
        case "window":
          return [{ sources: target.originals }]
        case "synthesis":
          return []
        default:
          return assertNever(target)
      }
    }) ?? []
  const batchOriginals =
    rich?.batched?.manifest?.targets.map((target) => ({ sources: target.originals })) ?? []
  for (const finding of [
    ...record.claims,
    ...record.concepts,
    ...record.qualifications,
    ...(rich?.maps.flatMap(chapterFindings) ?? []),
    ...(rich?.synthesis ? synthesisFindings(rich.synthesis) : []),
    ...verifiedOriginals,
    ...batchOriginals,
  ]) {
    for (const span of finding.sources) {
      if (rich) {
        const resource = normalization.resources.find(
          (resource) => resource.path === span.resourcePath,
        )
        const block =
          resource?.status === "included"
            ? resource.blocks.find((block) => block.id === span.blockId)
            : undefined
        if (
          span.editionId !== normalization.editionId ||
          span.normalizationRevisionId !== normalization.id ||
          !block ||
          span.end > block.text.length ||
          block.text.slice(span.start, span.end) !== span.originalFragment ||
          block.pageLabel !== span.pageLabel ||
          !span.originalFragment.isWellFormed()
        )
          throw new ContractBoundaryError("analysis original passage mismatch")
      } else parseInput(LocatedSourceSpan, { normalization, span }, "analysis source span")
    }
  }
}
