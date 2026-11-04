import { contentDigest, FullBookTestSession, planFullBookTest } from "@reading-studio/contracts"
import { fullBookSession, pluralMapOutput } from "./full-book-test-fixture.ts"

export function directFixture() {
  const initial = fullBookSession()
  const input = {
    ...initial.input,
    hierarchyPolicy: "direct-children-2",
    windows: initial.input.windows.flat().map((span) => [span]),
  }
  const session = FullBookTestSession.parse({ ...initial, input, plan: planFullBookTest(input) })
  const maps = session.input.windows.map((_, index) => ({
    ...pluralMapOutput(session, index),
    policyVersion: "direct-children-2",
    targetHash: contentDigest(
      JSON.stringify({ session, node: session.plan.nodes[index], children: [] }),
    ),
  }))
  const receipts = maps.map((map) => {
    const serialized = JSON.stringify(map)
    return { serialized, outputHash: contentDigest(serialized) }
  })
  const node = session.plan.nodes[maps.length]
  if (!node) throw new TypeError("Missing direct-child root")
  const children = node.children.map((id, index) => {
    const receipt = receipts[index],
      output = maps[index]
    if (!receipt || !output) throw new TypeError("Missing direct-child map")
    return { id, receipt, output }
  })
  const groupIds = children.flatMap((child) => child.output.groupIds)
  const findings = ["purpose", "summary", "qualification"].map((kind) => ({
    id: `root-${kind}`,
    kind,
    text: `Consolidated ${kind} with both attributed constraints; semantic support still requires original checks.`,
    groupIds,
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
  }))
  const output = {
    kind: "analysis",
    policyVersion: "direct-children-2",
    targetHash: contentDigest(
      JSON.stringify({
        session,
        node,
        children: children.map((child) => ({
          nodeId: child.id,
          outputHash: child.receipt.outputHash,
        })),
      }),
    ),
    complete: true,
    children: children.map((child) => ({ nodeId: child.id, outputHash: child.receipt.outputHash })),
    coverage: children.map((child) => child.receipt.outputHash),
    groupIds,
    findings,
    contributions: children.flatMap((child) =>
      child.output.findings.map((finding) => ({
        childNodeId: child.id,
        childOutputHash: child.receipt.outputHash,
        findingId: finding.id,
        outputFindingIds: [`root-${finding.kind}`],
        disposition: "qualified",
        explanation: "Attributed consolidation, not a claim of semantic equivalence.",
      })),
    ),
  }
  return { session, maps, receipts, node, output }
}
