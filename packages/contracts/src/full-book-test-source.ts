import {
  type FullBookAnalysisOutput,
  type FullBookFinding,
  FullBookOutputError,
  type FullBookTestSession,
} from "./full-book-test-output.ts"
import { contentDigest } from "./identity.ts"
import { assertNever, type Digest } from "./primitives.ts"

export function fullBookFragments(session: FullBookTestSession) {
  return session.input.windows.map((window) =>
    window.map((original) => {
      const group = session.input.groups.find((group) => group.blockIds.includes(original.blockId))
      if (!group) throw new FullBookOutputError("lineage")
      return {
        id: contentDigest(JSON.stringify({ groupId: group.id, original })),
        groupId: group.id,
        original,
      }
    }),
  )
}
export type FullBookFragment = ReturnType<typeof fullBookFragments>[number][number]

export function findingSourceGroups(
  finding: FullBookFinding,
  fragments: readonly FullBookFragment[],
  children: readonly Readonly<{
    id: string
    output: FullBookAnalysisOutput
    outputHash?: string
  }>[],
) {
  const groups = finding.citations.flatMap((citation) => {
    switch (citation.kind) {
      case "fragment": {
        if (children.length > 0) throw new FullBookOutputError("citation")
        const fragment = fragments.find((fragment) => fragment.id === citation.fragmentId)
        if (
          !fragment ||
          citation.start < fragment.original.start ||
          citation.end > fragment.original.end ||
          citation.end <= citation.start ||
          !fragment.original.originalFragment
            .slice(citation.start - fragment.original.start, citation.end - fragment.original.start)
            .isWellFormed()
        )
          throw new FullBookOutputError("citation")
        return [fragment.groupId]
      }
      case "child": {
        if (
          citation.outputHash !== undefined &&
          citation.outputHash !== children.find((child) => child.id === citation.nodeId)?.outputHash
        )
          throw new FullBookOutputError("citation")
        const source = children
          .find((child) => child.id === citation.nodeId)
          ?.output.findings.find((finding) => finding.id === citation.findingId)
        if (!source) throw new FullBookOutputError("citation")
        return source.groupIds
      }
      default:
        return assertNever(citation)
    }
  })
  if (
    new Set(finding.citations.map((citation) => JSON.stringify(citation))).size !==
    finding.citations.length
  )
    throw new FullBookOutputError("citation")
  return [...new Set(groups)]
}

export function resolvedFindingOriginals(
  finding: FullBookFinding,
  context: Readonly<{
    fragments: readonly FullBookFragment[]
    outputs: readonly FullBookAnalysisOutput[]
    outputHashes?: readonly string[]
  }>,
): readonly Readonly<{ fragmentId: Digest; original: FullBookFragment["original"] }>[] {
  const pending = [...finding.citations],
    visited = new Set<string>()
  const originals = new Map<
    string,
    Readonly<{ fragmentId: Digest; original: FullBookFragment["original"] }>
  >()
  while (pending.length > 0) {
    const citation = pending.pop()
    if (!citation) throw new FullBookOutputError("citation")
    const key = JSON.stringify(citation)
    if (visited.has(key)) continue
    visited.add(key)
    switch (citation.kind) {
      case "fragment": {
        const fragment = context.fragments.find((fragment) => fragment.id === citation.fragmentId)
        if (!fragment) throw new FullBookOutputError("citation")
        originals.set(key, {
          fragmentId: fragment.id,
          original: {
            ...fragment.original,
            start: citation.start,
            end: citation.end,
            originalFragment: fragment.original.originalFragment.slice(
              citation.start - fragment.original.start,
              citation.end - fragment.original.start,
            ),
          },
        })
        break
      }
      case "child": {
        const index = Number(citation.nodeId.slice(3))
        const child = context.outputs[index]?.findings.find(
          (finding) => finding.id === citation.findingId,
        )
        if (
          !child ||
          (citation.outputHash !== undefined &&
            context.outputHashes?.[index] !== citation.outputHash)
        )
          throw new FullBookOutputError("citation")
        pending.push(...child.citations)
        break
      }
      default:
        assertNever(citation)
    }
  }
  return [...originals.values()]
}
