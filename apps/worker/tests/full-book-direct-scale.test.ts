import {
  contentDigest,
  type FullBookTestReceipt,
  FullBookTestSession,
  fullBookManagedThread,
  fullBookTestReplayRequests,
  fullBookUnusedBatch,
  measureFullBookTestPayload,
  planFullBookTest,
  restoreFullBookTest,
} from "@reading-studio/contracts"
import { localToolInput } from "@reading-studio/providers"
import { serializeRpcFrame } from "@reading-studio/storage"
import { expect, it } from "vitest"
import { z } from "zod"
import { directOutput } from "./full-book-direct-output.ts"
import { fullBookSession } from "./full-book-test-fixture.ts"

it.each([
  { windows: 158, jobs: 3550, attempts: 7100, needed: 529, reductions: 54, unused: 3021 },
  { windows: 148, jobs: 3327, attempts: 6654, needed: 496, reductions: 51, unused: 2831 },
  { windows: 180, jobs: 4041, attempts: 8082, needed: 602, reductions: 61, unused: 3439 },
])(
  "fits readable direct children and original checks at $windows windows",
  (expected) => {
    // Given fixed measured/stress window envelopes, nineteen attributed groups and unchanged byte/finding caps.
    const initial = fullBookSession(),
      blocks = Array.from({ length: expected.windows }, (_, index) => ({
        id: contentDigest(`synthetic-block-${index}`),
        text: `Synthetic passage ${index}: ${"Retained evidence includes an important exception and a competing constraint. ".repeat(7)}`,
      }))
    const normalization = {
      ...initial.input.normalization,
      resources: [{ path: "synthetic-scale", role: "main-chapter", status: "included", blocks }],
    }
    const input = {
      ...initial.input,
      hierarchyPolicy: "direct-children-2",
      normalization,
      groups: Array.from({ length: 19 }, (_, index) => ({
        id: contentDigest(`synthetic-group-${index}`),
        blockIds: blocks
          .slice(
            Math.floor((index * expected.windows) / 19),
            Math.floor(((index + 1) * expected.windows) / 19),
          )
          .map((block) => block.id),
      })),
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
    const receipts: FullBookTestReceipt[] = []
    const setupFrame = serializeRpcFrame({
      provider: "chatgpt-subscription",
      id: 2147483646,
      method: "thread/start",
      params: fullBookManagedThread(
        session.model,
        `/private/tmp/tenjinsan-study-${"x".repeat(128)}`,
      ),
      binding: "f".repeat(64),
    })
    let root: FullBookTestReceipt | undefined,
      unused = 0,
      maximumOutput = 0
    // When controlled synthetic outputs preserve hashed lineage and original checks, never semantic text equality.
    for (const node of session.plan.nodes) {
      const skipped = root ? fullBookUnusedBatch(session, root, receipts.length) : null
      const output = skipped ?? directOutput(session, receipts),
        serialized = JSON.stringify(output)
      const receipt = { serialized, outputHash: contentDigest(serialized) }
      maximumOutput = Math.max(
        maximumOutput,
        measureFullBookTestPayload(session.input, { kind: "derived-output", serialized }).bytes,
      )
      receipts.push(receipt)
      if (node.id === session.plan.root) root = receipt
      if (skipped) unused++
    }
    const restored = restoreFullBookTest(session, receipts)
    let requests = 0,
      maximumRequest = 0,
      reductions = 0,
      finalWindows = 0,
      mapWindows = 0,
      levels = 0
    for (const { target, request } of fullBookTestReplayRequests(session, receipts)) {
      const frame = serializeRpcFrame({
        provider: "chatgpt-subscription",
        id: 2147483647,
        method: "turn/start",
        params: { threadId: "t".repeat(256), ...localToolInput("chatgpt-subscription", request) },
        binding: target.hash,
      })
      expect(
        frame.bytes,
        JSON.stringify({ kind: target.node.kind, level: target.node.level, node: target.node.id }),
      ).toBeLessThanOrEqual(session.input.policy.maxAppBytes)
      expect(frame.bytes + setupFrame.bytes).toBeLessThanOrEqual(session.input.policy.maxAppBytes)
      maximumRequest = Math.max(
        maximumRequest,
        measureFullBookTestPayload(session.input, {
          kind: "application-request",
          serialized: frame.serialized,
        }).bytes,
      )
      const body: unknown = z
        .tuple([z.unknown(), z.unknown()])
        .parse(JSON.parse(request.prompt.slice(request.prompt.indexOf("\n") + 1)))[1]
      switch (target.node.kind) {
        case "reduce": {
          const parsed = z
            .object({
              children: z.array(
                z.object({
                  findings: z.array(z.object({ text: z.string() })).min(1),
                  output: z.unknown().optional(),
                  outputHash: z.string(),
                }),
              ),
            })
            .parse(body)
          expect(
            parsed.children.every(
              (child) =>
                child.findings.every((finding) => finding.text.length > 100) &&
                child.output === undefined,
            ),
          ).toBe(true)
          reductions++
          levels = Math.max(levels, target.node.level)
          break
        }
        case "map-check":
        case "final-check": {
          const parsed = z
            .object({
              originals: z.array(z.unknown()),
              localMap: z.object({ findings: z.array(z.unknown()).min(1) }),
              findings: z.array(z.unknown()).min(1),
            })
            .parse(body)
          expect(parsed.originals).toEqual(session.input.windows[target.node.window ?? -1])
          if (target.node.kind === "final-check") finalWindows++
          else mapWindows++
          break
        }
        case "citation-check":
          expect(
            z.object({ checkedWindows: z.array(z.unknown()).length(expected.windows) }).parse(body)
              .checkedWindows,
          ).toHaveLength(expected.windows)
          break
        case "map":
          break
        default:
          throw new TypeError("Unknown scale node")
      }
      requests++
    }
    // Then every reduction and needed window check fits; unused nodes are explicit proof, not issued calls or supported verdicts.
    expect(restored.receipts).toHaveLength(expected.jobs)
    expect({ requests, reductions, levels, finalWindows, mapWindows, unused }).toEqual({
      requests: expected.needed,
      reductions: expected.reductions,
      levels: 4,
      finalWindows: expected.windows,
      mapWindows: expected.windows,
      unused: expected.unused,
    })
    expect(session.plan.maxAttempts).toBe(expected.attempts)
    console.log(
      JSON.stringify({
        event: "direct-children-scale",
        windows: expected.windows,
        plannedMaxJobs: expected.jobs,
        plannedMaxAttempts: expected.attempts,
        syntheticNeededRequests: requests,
        unissuedNotNeeded: unused,
        releasedUnusedSlots: unused * 2,
        maximumRequest,
        maximumOutput,
        reductionLevels: levels,
        controlledGraphComplete: true,
        setupBytes: setupFrame.bytes,
        maximumAttemptBytes: maximumRequest + setupFrame.bytes,
        actualModelCalls: 0,
        semanticAssessment: false,
      }),
    )
  },
  120000,
)
