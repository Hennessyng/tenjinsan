import {
  assertNever,
  FullBookAnalysisOutput,
  type FullBookTestReceipt,
  type FullBookTestSession,
  fullBookTestTarget,
  fullBookVerificationFindings,
} from "@reading-studio/contracts"
import { pluralMapOutput } from "./full-book-test-fixture.ts"

export function directOutput(
  session: FullBookTestSession,
  receipts: readonly FullBookTestReceipt[],
) {
  const target = fullBookTestTarget(session, receipts),
    node = target.node
  const children = node.children.map((id) => {
    const receipt = receipts[session.plan.nodes.findIndex((candidate) => candidate.id === id)]
    if (!receipt) throw new TypeError("Missing immutable synthetic child")
    return { id, receipt, output: FullBookAnalysisOutput.parse(JSON.parse(receipt.serialized)) }
  })
  switch (node.kind) {
    case "map": {
      const output = pluralMapOutput(session, node.window ?? -1)
      return {
        ...output,
        policyVersion: "direct-children-2",
        targetHash: target.hash,
        findings: output.findings.map((finding) => ({
          ...finding,
          text: `${finding.kind}: ${"A bounded synthetic explanation with important locally attributed constraints. ".repeat(3)}`,
        })),
      }
    }
    case "reduce": {
      const groupIds = [...new Set(children.flatMap((child) => child.output.groupIds))]
      const kinds = [
        ...new Set(
          children.flatMap((child) => child.output.findings.map((finding) => finding.kind)),
        ),
      ]
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
        findings: kinds.map((kind) => ({
          id: `${node.id}-${kind}`,
          kind,
          groupIds,
          text: `Consolidated ${kind}. ${"Retain attributed limits and competing evidence; this scripted text is not semantic proof. ".repeat(2)}`,
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
            explanation:
              "Explicitly attributed consolidation; correctness requires independent original checks.",
          })),
        ),
      }
    }
    case "map-check":
    case "final-check":
    case "citation-check": {
      const child = children[0]
      if (!child) throw new TypeError("Missing synthetic verification child")
      return {
        kind: "verification",
        targetHash: target.hash,
        decisions: fullBookVerificationFindings(session, node, child.output).map((finding) => ({
          findingId: finding.id,
          verdict: "supported",
          explanation: "Controlled synthetic verdict, not an assessment.",
        })),
        materialCoverage:
          node.kind === "citation-check"
            ? null
            : {
                verdict: "none",
                explanation: "Controlled synthetic coverage verdict, not an assessment.",
              },
      }
    }
    default:
      return assertNever(node.kind)
  }
}
