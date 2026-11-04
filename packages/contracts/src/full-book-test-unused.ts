import {
  FullBookAnalysisOutput,
  FullBookNotNeeded,
  FullBookOutputError,
  type FullBookTestReceipt,
  type FullBookTestSession,
} from "./full-book-test-output.ts"
import { contentDigest } from "./identity.ts"

export function fullBookUnusedBatch(
  session: FullBookTestSession,
  root: FullBookTestReceipt,
  index: number,
) {
  const node = session.plan.nodes[index]
  if (
    session.input.hierarchyPolicy !== "direct-children-2" ||
    !node ||
    node.batch === null ||
    (node.kind !== "final-check" && node.kind !== "citation-check")
  )
    return null
  if (contentDigest(root.serialized) !== root.outputHash) throw new FullBookOutputError("lineage")
  const output = FullBookAnalysisOutput.parse(JSON.parse(root.serialized))
  if (
    output.policyVersion !== "direct-children-2" ||
    node.children.length !== 1 ||
    node.children[0] !== session.plan.root
  )
    throw new FullBookOutputError("lineage")
  if (node.batch * session.input.policy.findingsPerBatch < output.findings.length) return null
  const children = [{ nodeId: session.plan.root, outputHash: root.outputHash }]
  return FullBookNotNeeded.parse({
    kind: "not-needed",
    policyVersion: "direct-children-2",
    targetHash: contentDigest(JSON.stringify({ session, node, children })),
    rootNodeId: session.plan.root,
    rootHash: root.outputHash,
    findingCount: output.findings.length,
    batch: node.batch,
  })
}
