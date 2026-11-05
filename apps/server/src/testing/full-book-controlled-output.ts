import {
  FullBookAnalysisOutput,
  type FullBookTestReceipt,
  type FullBookTestSession,
  fullBookFragments,
  fullBookTestTarget,
  fullBookVerificationFindings,
} from "@reading-studio/contracts"

export function controlledFullBookOutput(
  session: FullBookTestSession,
  receipts: readonly FullBookTestReceipt[],
) {
  const target = fullBookTestTarget(session, receipts),
    node = target.node
  const children = node.children.map((id) => {
    const receipt = receipts[session.plan.nodes.findIndex((item) => item.id === id)]
    if (!receipt) throw new TypeError("Missing controlled child")
    return { id, receipt, output: FullBookAnalysisOutput.parse(JSON.parse(receipt.serialized)) }
  })
  switch (node.kind) {
    case "map": {
      const fragments = fullBookFragments(session)[node.window ?? -1]
      if (!fragments) throw new TypeError("Missing controlled source")
      const groupIds = [...new Set(fragments.map((fragment) => fragment.groupId))]
      return {
        kind: "analysis",
        policyVersion: "direct-children-2",
        targetHash: target.hash,
        complete: true,
        children: [],
        coverage: fragments.map((fragment) => fragment.id),
        groupIds,
        findings: ["purpose", "summary", "qualification"].map((kind) => ({
          id: `${node.id}-${kind}`,
          kind,
          groupIds,
          text: `Controlled synthetic ${kind}; not a semantic assessment.`,
          citations: fragments.map((fragment) => ({
            kind: "fragment",
            fragmentId: fragment.id,
            start: fragment.original.start,
            end: fragment.original.end,
          })),
        })),
        contributions: [],
      }
    }
    case "reduce": {
      const groupIds = [...new Set(children.flatMap((child) => child.output.groupIds))]
      return {
        kind: "analysis",
        policyVersion: "direct-children-2",
        targetHash: target.hash,
        complete: true,
        children: children.map((child) => ({
          nodeId: child.id,
          outputHash: child.receipt.outputHash,
        })),
        coverage: children.map((child) => child.receipt.outputHash),
        groupIds,
        findings: ["purpose", "summary", "qualification"].map((kind) => ({
          id: `${node.id}-${kind}`,
          kind,
          groupIds,
          text: `Consolidated synthetic ${kind}; no meaning claim.`,
          citations: children.flatMap((child) =>
            child.output.findings
              .filter((finding) => finding.kind === kind)
              .map((finding) => ({
                kind: "child",
                nodeId: child.id,
                findingId: finding.id,
                outputHash: child.receipt.outputHash,
              })),
          ),
        })),
        contributions: children.flatMap((child) =>
          child.output.findings.map((finding) => ({
            childNodeId: child.id,
            childOutputHash: child.receipt.outputHash,
            findingId: finding.id,
            outputFindingIds: [`${node.id}-${finding.kind}`],
            disposition: "qualified",
            explanation: "Controlled attribution only.",
          })),
        ),
      }
    }
    case "map-check":
    case "final-check":
    case "citation-check": {
      const child = children[0]
      if (!child) throw new TypeError("Missing controlled verifier child")
      return {
        kind: "verification",
        targetHash: target.hash,
        decisions: fullBookVerificationFindings(session, node, child.output).map((finding) => ({
          findingId: finding.id,
          verdict: "supported",
          explanation: "Scripted fixture verdict, not semantic evidence.",
        })),
        materialCoverage:
          node.kind === "citation-check"
            ? null
            : { verdict: "none", explanation: "Scripted fixture coverage." },
      }
    }
    default:
      throw new TypeError("Unknown controlled node")
  }
}
