import { serializeRpcFrame } from "@reading-studio/storage"
import { expect, it } from "vitest"
import { measureFullBookTestPayload } from "../src/full-book-test-bytes.ts"
import { FullBookTestInput } from "../src/full-book-test-contract.ts"
import { contentDigest } from "../src/identity.ts"

const input = FullBookTestInput.parse({
  version: "full-book-test-1",
  purpose: "experimental-analysis-only",
  routeEvidence: "experimental-app-guards-not-live-certificate",
  normalization: {
    id: "normalization",
    editionId: "edition",
    editionHash: "a".repeat(64),
    parserVersion: "test-1",
    normalizerVersion: "test-1",
    coverage: "complete",
    resources: [
      {
        path: "book.txt",
        role: "main-chapter",
        status: "included",
        blocks: [{ id: "block", text: "書😀" }],
      },
    ],
  },
  groups: [{ id: "group", blockIds: ["block"] }],
  windows: [
    [
      {
        editionId: "edition",
        normalizationRevisionId: "normalization",
        resourcePath: "book.txt",
        blockId: "block",
        start: 0,
        end: 3,
        originalFragment: "書😀",
      },
    ],
  ],
  policy: {
    fanout: 2,
    maxLevels: 1,
    maxFindings: 2,
    findingsPerBatch: 1,
    maxNodes: 100,
    maxAttempts: 100,
    maxAppBytes: 32_000,
    maxOutputBytes: 16_000,
    attemptsPerNode: 2,
  },
})

it("measures the actual newline-terminated native RPC serialization, not source characters", () => {
  // Given a production-serialized frame containing non-ASCII text and escaping.
  const frame = serializeRpcFrame({
    provider: "chatgpt-subscription",
    id: 1,
    method: "turn/start",
    params: { input: '書😀\n"' },
  })
  // When the byte guard observes the entire serialized frame.
  const observation = measureFullBookTestPayload(input, {
    kind: "application-request",
    serialized: frame.serialized,
  })
  // Then its exact bytes and digest match the native writer's observation.
  expect(observation).toEqual({
    bytes: frame.bytes,
    hash: frame.sha256,
    layer: "application-serialization-only",
  })
  expect(observation.bytes).toBeGreaterThan(frame.serialized.length)
})

it.each(["application-request", "derived-output"] as const)(
  "refuses an oversized %s without truncating or extending the plan",
  (kind) => {
    // Given serialized content above each finite byte bound.
    const serialized = JSON.stringify({ text: "書".repeat(11_000) })
    // When/Then the same guard can refuse at enqueue or dispatch.
    expect(() => measureFullBookTestPayload(input, { kind, serialized })).toThrow()
    expect(serialized).toBe(JSON.stringify({ text: "書".repeat(11_000) }))
  },
)

it("accepts an exact byte boundary and preserves the exact serialized output commitment", () => {
  // Given an output with escaping and a byte limit equal to its serialized size.
  const serialized = JSON.stringify({ text: '書😀\n"' })
  const bounded = {
    ...input,
    policy: { ...input.policy, maxOutputBytes: Buffer.byteLength(serialized, "utf8") },
  }
  // When the already serialized output is measured.
  const observation = measureFullBookTestPayload(bounded, { kind: "derived-output", serialized })
  // Then it fits without a reserialization or normalization of the content.
  expect(observation.hash).toBe(contentDigest(serialized))
  expect(observation.bytes).toBe(bounded.policy.maxOutputBytes)
})
