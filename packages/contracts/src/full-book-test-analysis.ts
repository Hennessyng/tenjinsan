import {
  type FullBookAnalysisOutput,
  FullBookOutputError,
  type FullBookTestSession,
} from "./full-book-test-output.ts"
import { type FullBookFragment, findingSourceGroups } from "./full-book-test-source.ts"
import { assertNever } from "./primitives.ts"

export type FullBookChild = Readonly<{
  id: string
  outputHash: string
  output: FullBookAnalysisOutput
}>
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

export function validateFullBookAnalysis(
  session: FullBookTestSession,
  output: FullBookAnalysisOutput,
  scope: Readonly<{ fragments: readonly FullBookFragment[]; children: readonly FullBookChild[] }>,
) {
  const { fragments, children } = scope
  const direct = session.input.hierarchyPolicy === "direct-children-2"
  if (output.policyVersion !== session.input.hierarchyPolicy)
    throw new FullBookOutputError("lineage")
  const coverage =
    children.length > 0
      ? direct
        ? children.map((child) => child.outputHash)
        : children.flatMap((child) => child.output.coverage)
      : fragments.map((fragment) => fragment.id)
  const groups = [
    ...new Set(
      direct && children.length
        ? children.flatMap((child) => child.output.groupIds)
        : fragments
            .filter((fragment) => coverage.includes(fragment.id))
            .map((fragment) => fragment.groupId),
    ),
  ]
  if (
    !equal(output.coverage, coverage) ||
    !equal(output.groupIds, groups) ||
    !equal(
      output.children,
      children.map((child) => ({ nodeId: child.id, outputHash: child.outputHash })),
    )
  )
    throw new FullBookOutputError("lineage")
  if (
    output.findings.length > session.input.policy.maxFindings ||
    new Set(output.findings.map((finding) => finding.id)).size !== output.findings.length
  )
    throw new FullBookOutputError("findings")
  for (const finding of output.findings) {
    if (
      direct &&
      finding.citations.some(
        (citation) =>
          citation.kind === "child" &&
          citation.outputHash !==
            children.find((child) => child.id === citation.nodeId)?.outputHash,
      )
    )
      throw new FullBookOutputError("citation")
    if (!equal(finding.groupIds, findingSourceGroups(finding, fragments, children)))
      throw new FullBookOutputError("citation")
  }
  for (const group of groups) {
    if (
      !["purpose", "summary"].every((kind) =>
        output.findings.some(
          (finding) => finding.kind === kind && finding.groupIds.includes(group),
        ),
      )
    )
      throw new FullBookOutputError("findings")
  }
  const expected = children.flatMap((child) =>
    child.output.findings.map((finding) => ({ childNodeId: child.id, findingId: finding.id })),
  )
  if (
    !equal(
      output.contributions.map(({ childNodeId, findingId }) => ({ childNodeId, findingId })),
      expected,
    )
  )
    throw new FullBookOutputError("lineage")
  for (const contribution of output.contributions) {
    const child = children
      .find((child) => child.id === contribution.childNodeId)
      ?.output.findings.find((finding) => finding.id === contribution.findingId)
    if (
      direct &&
      contribution.childOutputHash !==
        children.find((child) => child.id === contribution.childNodeId)?.outputHash
    )
      throw new FullBookOutputError("lineage")
    if (
      !child ||
      contribution.disposition === "omitted" ||
      new Set(contribution.outputFindingIds).size !== contribution.outputFindingIds.length
    )
      throw new FullBookOutputError("lineage")
    for (const id of contribution.outputFindingIds) {
      const finding = output.findings.find((finding) => finding.id === id)
      if (
        !finding?.citations.some(
          (citation) =>
            citation.kind === "child" &&
            citation.nodeId === contribution.childNodeId &&
            citation.findingId === contribution.findingId,
        )
      )
        throw new FullBookOutputError("citation")
      switch (child.kind) {
        case "qualification":
        case "counterargument":
        case "uncertainty":
          if (finding.kind !== child.kind || (!direct && finding.text !== child.text))
            throw new FullBookOutputError("lineage")
          break
        case "purpose":
        case "summary":
        case "claim":
        case "concept":
        case "definition":
        case "example":
          break
        default:
          assertNever(child.kind)
      }
    }
  }
  for (const finding of output.findings) {
    for (const citation of finding.citations) {
      if (
        citation.kind === "child" &&
        !output.contributions.some(
          (contribution) =>
            contribution.childNodeId === citation.nodeId &&
            contribution.findingId === citation.findingId &&
            contribution.outputFindingIds.includes(finding.id),
        )
      )
        throw new FullBookOutputError("lineage")
    }
  }
}
