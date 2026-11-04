import { Writable } from "node:stream"
import {
  assertNever,
  FullBookAnalysisOutput,
  FullBookTestError,
  FullBookTestSession,
  planFullBookTest,
} from "@reading-studio/contracts"
import { RpcFrameWriter } from "@reading-studio/storage"
import { expect, it } from "vitest"
import { FullBookTestRuntime } from "../src/full-book-test-runtime.ts"
import { fullBookSession, pluralMapOutput } from "./full-book-test-fixture.ts"

it("refuses rich derived overflow without losing material exceptions at the measured 148-window scale", () => {
  // Given synthetic passages at the measured book window count and the unchanged UI policy.
  const initial = fullBookSession()
  const blocks = Array.from({ length: 148 }, (_, index) => ({
    id: `passage-${index}`,
    text: `Part ${index}. Exception ${index}: ${"This local evidence does not apply under an unresolved competing obligation. ".repeat(7)}`,
  }))
  const normalization = {
    ...initial.input.normalization,
    resources: [{ path: "synthetic-scale", status: "included", role: "main-chapter", blocks }],
  }
  const input = {
    ...initial.input,
    normalization,
    groups: blocks.map((block, index) => ({ id: `group-${index}`, blockIds: [block.id] })),
    windows: blocks.map((block) => [
      {
        editionId: normalization.editionId,
        normalizationRevisionId: normalization.id,
        resourcePath: "synthetic-scale",
        blockId: block.id,
        start: 0,
        end: block.text.length,
        originalFragment: block.text,
      },
    ]),
    policy: {
      fanout: 4,
      maxLevels: 8,
      maxFindings: 120,
      findingsPerBatch: 6,
      maxNodes: 10000,
      maxAttempts: 10000,
      maxAppBytes: 32000,
      maxOutputBytes: 16000,
      attemptsPerNode: 2,
    },
  }
  const session = FullBookTestSession.parse({ ...initial, input, plan: planFullBookTest(input) })
  const runtime = new FullBookTestRuntime(session)
  const writer = new RpcFrameWriter(
    "chatgpt-subscription",
    new Writable({
      write(_chunk, _encoding, callback) {
        callback()
      },
    }),
  )
  let maximumFrameBytes = 0,
    acceptedMaps = 0,
    acceptedReductionLevel = 0
  let refused: Readonly<{ kind: string; level: number; phase: string; reason: string }> | null =
    null
  // When actual request builders accept substantive synthetic maps and source-linked many-to-one reductions.
  for (const node of session.plan.nodes) {
    let phase = "prequeue"
    try {
      const receipts = runtime.snapshot(),
        job = runtime.prequeue(writer, "synthetic-thread")
      maximumFrameBytes = Math.max(maximumFrameBytes, runtime.beforeDispatch(job, writer).bytes)
      let output: unknown
      switch (node.kind) {
        case "map": {
          const map = pluralMapOutput(session, node.window ?? -1)
          output = {
            ...map,
            targetHash: job.targetHash,
            findings: map.findings.map((finding) => ({
              ...finding,
              text:
                finding.kind === "qualification"
                  ? blocks[node.window ?? -1]?.text
                  : `${finding.kind}: a constrained process backed by the supplied synthetic evidence.`,
            })),
          }
          break
        }
        case "reduce": {
          const children = node.children.map((id) => {
            const receipt =
              receipts[session.plan.nodes.findIndex((candidate) => candidate.id === id)]
            if (!receipt) throw new TypeError("Missing scale child")
            return {
              id,
              receipt,
              output: FullBookAnalysisOutput.parse(JSON.parse(receipt.serialized)),
            }
          })
          const groupIds = [...new Set(children.flatMap((child) => child.output.groupIds))]
          const aggregate = ["purpose", "summary"].map((kind) => ({
            id: `${node.id}-${kind}`,
            kind,
            groupIds,
            text: "The process depends on all retained evidence, constraints and exceptions.",
            citations: children.flatMap((child) =>
              child.output.findings
                .filter((finding) => finding.kind === kind)
                .map((finding) => ({ kind: "child", nodeId: child.id, findingId: finding.id })),
            ),
          }))
          const exceptions = children.flatMap((child) =>
            child.output.findings
              .filter((finding) => finding.kind === "qualification")
              .map((finding) => ({
                ...finding,
                id: `${child.id}-${finding.id}`,
                citations: [{ kind: "child", nodeId: child.id, findingId: finding.id }],
              })),
          )
          output = {
            kind: "analysis",
            targetHash: job.targetHash,
            complete: true,
            children: children.map((child) => ({
              nodeId: child.id,
              outputHash: child.receipt.outputHash,
            })),
            coverage: children.flatMap((child) => child.output.coverage),
            groupIds,
            findings: [...aggregate, ...exceptions],
            contributions: children.flatMap((child) =>
              child.output.findings.map((finding) => ({
                childNodeId: child.id,
                findingId: finding.id,
                outputFindingIds: [
                  finding.kind === "qualification"
                    ? `${child.id}-${finding.id}`
                    : `${node.id}-${finding.kind}`,
                ],
                disposition: "retained",
                explanation: "Retained through source-linked aggregate or verbatim exception.",
              })),
            ),
          }
          break
        }
        case "map-check":
        case "final-check":
        case "citation-check":
          throw new TypeError(
            "Rich scale must refuse before reaching verification; do not invent semantic verdicts",
          )
        default:
          assertNever(node.kind)
      }
      phase = "accept"
      runtime.accept(job, JSON.stringify(output))
      if (node.kind === "map") acceptedMaps++
      if (node.kind === "reduce")
        acceptedReductionLevel = Math.max(acceptedReductionLevel, node.level)
    } catch (error) {
      if (!(error instanceof FullBookTestError)) throw error
      refused = { kind: node.kind, level: node.level, phase, reason: error.reason }
      break
    }
  }
  // Then all proposed maps and at least one reduction level complete, but overflow never truncates or grows authority.
  expect(acceptedMaps).toBe(148)
  expect(acceptedReductionLevel).toBeGreaterThanOrEqual(1)
  expect(refused).toMatchObject({ kind: "reduce", reason: "bytes" })
  expect(maximumFrameBytes).toBeLessThanOrEqual(32000)
  expect(session.plan.nodes).toHaveLength(3327)
  expect(session.plan.maxAttempts).toBe(6654)
  expect(runtime.snapshot().length).toBeLessThan(session.plan.nodes.length)
  console.log(
    JSON.stringify({
      event: "synthetic-full-book-scale",
      windows: 148,
      acceptedMaps,
      acceptedReductionLevel,
      acceptedFakeStages: runtime.snapshot().length,
      maximumFrameBytes,
      refused,
      completed: false,
      modelCalls: 0,
      meaningAssessed: false,
    }),
  )
}, 120000)
