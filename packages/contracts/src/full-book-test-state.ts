import { z } from "zod"
import { type FullBookChild, validateFullBookAnalysis } from "./full-book-test-analysis.ts"
import { measureFullBookTestPayload } from "./full-book-test-bytes.ts"
import type { FullBookTestNode } from "./full-book-test-contract.ts"
import {
  type FullBookAnalysisOutput,
  FullBookNotNeeded,
  FullBookOutputError,
  FullBookTestOutput,
  FullBookTestReceipt,
  FullBookTestSession,
} from "./full-book-test-output.ts"
import { validateFullBookTestPlan } from "./full-book-test-plan.ts"
import { fullBookFragments } from "./full-book-test-source.ts"
import { contentDigest } from "./identity.ts"
import { assertNever } from "./primitives.ts"

export function fullBookTestTarget(
  session: FullBookTestSession,
  receipts: readonly FullBookTestReceipt[],
) {
  const node = session.plan.nodes[receipts.length]
  if (!node) throw new FullBookOutputError("incomplete")
  const children = node.children.map((id) => {
    const index = session.plan.nodes.findIndex((node) => node.id === id),
      receipt = receipts[index]
    if (!receipt) throw new FullBookOutputError("lineage")
    return { nodeId: id, outputHash: receipt.outputHash }
  })
  return { node, children, hash: contentDigest(JSON.stringify({ session, node, children })) }
}

export function fullBookVerificationFindings(
  session: FullBookTestSession,
  node: FullBookTestNode,
  child: FullBookAnalysisOutput,
) {
  if (node.batch === null) return child.findings
  const start = node.batch * session.input.policy.findingsPerBatch
  return child.findings.slice(start, start + session.input.policy.findingsPerBatch)
}

export function restoreFullBookTest(sessionValue: unknown, receiptValues: unknown) {
  const session = FullBookTestSession.parse(sessionValue)
  validateFullBookTestPlan(session.input, session.plan)
  const receipts = z
    .array(FullBookTestReceipt)
    .max(session.plan.nodes.length)
    .readonly()
    .parse(receiptValues)
  const outputs: FullBookTestOutput[] = [],
    accepted: FullBookTestReceipt[] = []
  for (const receipt of receipts) {
    const observation = measureFullBookTestPayload(session.input, {
      kind: "derived-output",
      serialized: receipt.serialized,
    })
    if (observation.hash !== receipt.outputHash) throw new FullBookOutputError("lineage")
    const output = FullBookTestOutput.parse(JSON.parse(receipt.serialized))
    const target = fullBookTestTarget(session, accepted)
    if (output.targetHash !== target.hash) throw new FullBookOutputError("lineage")
    const children: FullBookChild[] = target.children.map((child) => {
      const index = session.plan.nodes.findIndex((node) => node.id === child.nodeId),
        output = outputs[index]
      if (output?.kind !== "analysis") throw new FullBookOutputError("lineage")
      return { id: child.nodeId, outputHash: child.outputHash, output }
    })
    switch (target.node.kind) {
      case "map":
      case "reduce": {
        if (output.kind !== "analysis") throw new FullBookOutputError("lineage")
        const windows = fullBookFragments(session)
        const fragments = target.node.window === null ? windows.flat() : windows[target.node.window]
        if (!fragments) throw new FullBookOutputError("lineage")
        validateFullBookAnalysis(session, output, { fragments, children })
        break
      }
      case "map-check":
      case "final-check":
      case "citation-check": {
        const child = children[0]
        const unused = unusedOutput(session, target, child)
        if (unused) {
          if (JSON.stringify(output) !== JSON.stringify(unused))
            throw new FullBookOutputError("verification")
          break
        }
        if (output.kind !== "verification" || !child) throw new FullBookOutputError("verification")
        const findings = fullBookVerificationFindings(session, target.node, child.output)
        if (
          JSON.stringify(output.decisions.map((decision) => decision.findingId)) !==
            JSON.stringify(findings.map((finding) => finding.id)) ||
          output.decisions.some(
            (decision) =>
              decision.verdict !== "supported" &&
              !(target.node.kind === "final-check" && decision.verdict === "not-addressed"),
          ) ||
          (target.node.kind === "map-check" ||
          (session.input.hierarchyPolicy === "direct-children-2" &&
            target.node.kind === "final-check")
            ? output.materialCoverage?.verdict !== "none"
            : output.materialCoverage !== null)
        )
          throw new FullBookOutputError("verification")
        break
      }
      default:
        assertNever(target.node.kind)
    }
    accepted.push(receipt)
    outputs.push(output)
  }
  return { session, receipts, outputs }
}

function unusedOutput(
  session: FullBookTestSession,
  target: ReturnType<typeof fullBookTestTarget>,
  child: FullBookChild | undefined,
) {
  const node = target.node
  if (
    session.input.hierarchyPolicy !== "direct-children-2" ||
    node.batch === null ||
    !child ||
    (node.kind !== "final-check" && node.kind !== "citation-check") ||
    node.batch * session.input.policy.findingsPerBatch < child.output.findings.length
  )
    return null
  if (child.id !== session.plan.root || child.output.findings.length === 0)
    throw new FullBookOutputError("verification")
  return FullBookNotNeeded.parse({
    kind: "not-needed",
    policyVersion: "direct-children-2",
    targetHash: target.hash,
    rootNodeId: session.plan.root,
    rootHash: child.outputHash,
    findingCount: child.output.findings.length,
    batch: node.batch,
  })
}

export function fullBookTestNotNeeded(
  session: FullBookTestSession,
  receipts: readonly FullBookTestReceipt[],
) {
  const restored = restoreFullBookTest(session, receipts),
    target = fullBookTestTarget(restored.session, restored.receipts)
  const child = target.children[0],
    output = child
      ? restored.outputs[restored.session.plan.nodes.findIndex((node) => node.id === child.nodeId)]
      : undefined
  return unusedOutput(
    restored.session,
    target,
    child && output?.kind === "analysis"
      ? { id: child.nodeId, outputHash: child.outputHash, output }
      : undefined,
  )
}

export function acceptFullBookTestOutput(
  session: FullBookTestSession,
  receipts: readonly FullBookTestReceipt[],
  serialized: string,
): readonly FullBookTestReceipt[] {
  const receipt = FullBookTestReceipt.parse({ serialized, outputHash: contentDigest(serialized) })
  return restoreFullBookTest(session, [...receipts, receipt]).receipts
}
