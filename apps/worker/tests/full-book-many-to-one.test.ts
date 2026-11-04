import { Writable } from "node:stream"
import {
  assertNever,
  FullBookAnalysisOutput,
  FullBookFinding,
  FullBookTestSession,
  planFullBookTest,
} from "@reading-studio/contracts"
import { fullBookTestRequest } from "@reading-studio/generation/full-book-test"
import { RpcFrameWriter } from "@reading-studio/storage"
import { expect, it } from "vitest"
import { z } from "zod"
import { FullBookTestRuntime } from "../src/full-book-test-runtime.ts"
import { fullBookSession, pluralMapOutput } from "./full-book-test-fixture.ts"

it("fits repeated many-to-one reductions while retaining every distinct exception and child reference", () => {
  // Given eight substantive synthetic passages and three reduction levels, not blank maps.
  const initial = fullBookSession()
  const blocks = Array.from({ length: 8 }, (_, i) => ({
    id: `passage-${i}`,
    text: `Part ${i} explains a useful focused-work process. Exception ${i}: ${"The process requires local evidence and does not apply under an unresolved competing obligation. ".repeat(5)}`,
  }))
  const normalization = {
    ...initial.input.normalization,
    resources: [{ path: "synthetic-growth", role: "main-chapter", status: "included", blocks }],
  }
  const input = {
    ...initial.input,
    normalization,
    groups: blocks.map((block, i) => ({ id: `part-${i}`, blockIds: [block.id] })),
    windows: blocks.map((block) => [
      {
        editionId: normalization.editionId,
        normalizationRevisionId: normalization.id,
        resourcePath: "synthetic-growth",
        blockId: block.id,
        start: 0,
        end: block.text.length,
        originalFragment: block.text,
      },
    ]),
    policy: { ...initial.input.policy, maxLevels: 3 },
  }
  const session = FullBookTestSession.parse({ ...initial, input, plan: planFullBookTest(input) })
  const runtime = new FullBookTestRuntime(session),
    writer = new RpcFrameWriter(
      "chatgpt-subscription",
      new Writable({
        write(_chunk, _encoding, callback) {
          callback()
        },
      }),
    )
  let maximumFrameBytes = 0,
    rootFindings = 0
  // When every real request builder is exercised with typed synthetic map/reduction/verdict outputs.
  for (const node of session.plan.nodes) {
    const receipts = runtime.snapshot(),
      built = fullBookTestRequest(session, receipts)
    const job = runtime.prequeue(writer, "synthetic-thread")
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
                : `${finding.kind}: this passage develops a constrained evidence-based process.`,
          })),
        }
        break
      }
      case "reduce": {
        const children = node.children.map((id) => {
          const receipt = receipts[session.plan.nodes.findIndex((node) => node.id === id)]
          if (!receipt) throw new TypeError("Missing growth child")
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
          text:
            kind === "purpose"
              ? "The parts describe an evidence-based process."
              : "The process is useful only with its retained constraints and exceptions.",
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
              explanation: "Retained through a source-linked aggregate or verbatim exception.",
            })),
          ),
        }
        if (node.id === session.plan.root) rootFindings = aggregate.length + exceptions.length
        break
      }
      case "map-check":
      case "final-check":
      case "citation-check": {
        const body = z
          .tuple([z.unknown(), z.object({ findings: z.array(FullBookFinding) })])
          .parse(JSON.parse(built.request.prompt.slice(built.request.prompt.indexOf("\n") + 1)))[1]
        output = {
          kind: "verification",
          targetHash: job.targetHash,
          decisions: body.findings.map((finding) => ({
            findingId: finding.id,
            verdict: "supported",
            explanation: "Synthetic controlled verdict; not semantic assessment.",
          })),
          materialCoverage:
            node.kind === "map-check"
              ? { verdict: "none", explanation: "Synthetic controlled coverage." }
              : null,
        }
        break
      }
      default:
        assertNever(node.kind)
    }
    runtime.accept(job, JSON.stringify(output))
  }
  // Then real bounded payloads fit without dropping any of the eight distinct material exceptions.
  expect(rootFindings).toBe(10)
  expect(runtime.snapshot()).toHaveLength(41)
  expect(maximumFrameBytes).toBeLessThanOrEqual(32_000)
  console.log(
    JSON.stringify({
      event: "experimental-many-to-one",
      windows: 8,
      reductionLevels: 3,
      rootFindings,
      retainedExceptions: 8,
      maximumFrameBytes,
      completedFakeStages: runtime.snapshot().length,
    }),
  )
})
