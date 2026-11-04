import {
  contentDigest,
  FullBookAnalysisOutput,
  type FullBookTestReceipt,
  FullBookTestSession,
  planFullBookTest,
} from "@reading-studio/contracts"
import { defaultSettings } from "@reading-studio/providers"

export function fullBookSession() {
  const normalization = {
    id: "norm",
    editionId: "edition",
    editionHash: "a".repeat(64),
    parserVersion: "fake-1",
    normalizerVersion: "fake-1",
    coverage: "complete",
    resources: [
      {
        path: "synthetic-book",
        status: "included",
        role: "main-chapter",
        blocks: [
          { id: "a", text: "First claim, except in winter." },
          { id: "b", text: "A later counterargument." },
          { id: "anchor", text: "" },
        ],
      },
    ],
  }
  const windows = [
    [
      {
        editionId: "edition",
        normalizationRevisionId: "norm",
        resourcePath: "synthetic-book",
        blockId: "a",
        start: 0,
        end: "First claim, except in winter.".length,
        originalFragment: "First claim, except in winter.",
      },
      {
        editionId: "edition",
        normalizationRevisionId: "norm",
        resourcePath: "synthetic-book",
        blockId: "b",
        start: 0,
        end: 24,
        originalFragment: "A later counterargument.",
      },
    ],
  ]
  const input = {
    version: "full-book-test-1",
    purpose: "experimental-analysis-only",
    routeEvidence: "experimental-app-guards-not-live-certificate",
    normalization,
    groups: [
      { id: "g1", blockIds: ["a"] },
      { id: "g2", blockIds: ["b", "anchor"] },
    ],
    windows,
    policy: {
      fanout: 2,
      maxLevels: 2,
      maxFindings: 12,
      findingsPerBatch: 6,
      maxNodes: 100,
      maxAttempts: 100,
      maxAppBytes: 32_000,
      maxOutputBytes: 16_000,
      attemptsPerNode: 2,
    },
  }
  return FullBookTestSession.parse({
    enabled: true,
    purpose: "full-book-test-1",
    input,
    plan: planFullBookTest(input),
    destination: {
      provider: "chatgpt-subscription",
      accountId: "synthetic",
      workspaceId: null,
      installationId: "synthetic",
      connectionRevision: 1,
      billingRoute: "subscription-provider-managed",
    },
    model: "synthetic-model",
    settings: defaultSettings,
  })
}

export function fixtureTarget(
  session: FullBookTestSession,
  receipts: readonly FullBookTestReceipt[],
) {
  const node = session.plan.nodes[receipts.length]
  if (!node) throw new TypeError("Missing fixture node")
  const children = node.children.map((id) => {
    const index = session.plan.nodes.findIndex((item) => item.id === id)
    const receipt = receipts[index]
    if (!receipt) throw new TypeError("Missing child fixture")
    return { nodeId: id, outputHash: receipt.outputHash }
  })
  return contentDigest(JSON.stringify({ session, node, children }))
}

export function pluralMapOutput(session: FullBookTestSession, window = 0) {
  const originals = session.input.windows[window]
  if (!originals) throw new TypeError("Missing fixture window")
  const fragments = originals.map((original) => {
    const group = session.input.groups.find((group) => group.blockIds.includes(original.blockId))
    if (!group) throw new TypeError("Missing fixture group")
    return {
      id: contentDigest(JSON.stringify({ groupId: group.id, original })),
      groupId: group.id,
      original,
    }
  })
  return {
    kind: "analysis",
    targetHash: fixtureTarget(session, []),
    complete: true,
    children: [],
    coverage: fragments.map((fragment) => fragment.id),
    groupIds: [...new Set(fragments.map((fragment) => fragment.groupId))],
    findings: fragments.flatMap((fragment, index) =>
      ["purpose", "summary", "qualification"].map((kind) => ({
        id: `finding-${index}-${kind}`,
        kind,
        text: `${kind}-${index}`,
        groupIds: [fragment.groupId],
        citations: [
          {
            kind: "fragment",
            fragmentId: fragment.id,
            start: fragment.original.start,
            end: fragment.original.end,
          },
        ],
      })),
    ),
    contributions: [],
  }
}

export function reductionOutput(
  session: FullBookTestSession,
  receipts: readonly FullBookTestReceipt[],
) {
  const node = session.plan.nodes[receipts.length]
  if (!node) throw new TypeError("Missing fixture node")
  const children = node.children.map((id) => {
    const receipt = receipts[session.plan.nodes.findIndex((node) => node.id === id)]
    if (!receipt) throw new TypeError("Missing fixture child")
    return { id, receipt, output: FullBookAnalysisOutput.parse(JSON.parse(receipt.serialized)) }
  })
  return {
    kind: "analysis",
    targetHash: fixtureTarget(session, receipts),
    complete: true,
    children: children.map((child) => ({ nodeId: child.id, outputHash: child.receipt.outputHash })),
    coverage: children.flatMap((child) => child.output.coverage),
    groupIds: [...new Set(children.flatMap((child) => child.output.groupIds))],
    findings: children.flatMap((child) =>
      child.output.findings.map((finding) => ({
        ...finding,
        id: `${child.id}-${finding.id}`,
        citations: [{ kind: "child", nodeId: child.id, findingId: finding.id }],
      })),
    ),
    contributions: children.flatMap((child) =>
      child.output.findings.map((finding) => ({
        childNodeId: child.id,
        findingId: finding.id,
        outputFindingIds: [`${child.id}-${finding.id}`],
        disposition: "retained",
        explanation: "Retained contribution",
      })),
    ),
  }
}
