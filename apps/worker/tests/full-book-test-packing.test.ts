import {
  assertNever,
  FullBookTestError,
  FullBookTestSession,
  planFullBookTest,
  validBatchPartition,
} from "@reading-studio/contracts"
import { fullBookTestMapRequest, packFullBookTest } from "@reading-studio/generation/full-book-test"
import { localToolInput } from "@reading-studio/providers"
import { serializeRpcFrame } from "@reading-studio/storage"
import { expect, it } from "vitest"
import { fullBookSession } from "./full-book-test-fixture.ts"

it("splits oversized Unicode primary ranges using actual plural-map frames without losing source", () => {
  // Given a synthetic source larger than one app frame with scalar boundaries near each split.
  const initial = fullBookSession(),
    text = "書😀".repeat(2000)
  const input = {
    ...initial.input,
    normalization: {
      ...initial.input.normalization,
      resources: initial.input.normalization.resources.map((resource) => {
        switch (resource.status) {
          case "included":
            return {
              ...resource,
              blocks: resource.blocks.map((block) => (block.text ? { ...block, text } : block)),
            }
          case "excluded":
            return resource
          default:
            return assertNever(resource)
        }
      }),
    },
    windows: initial.input.windows.map((window) =>
      window.map((span) => ({ ...span, end: text.length, originalFragment: text })),
    ),
    policy: {
      ...initial.input.policy,
      maxAppBytes: 14_000,
      maxLevels: 8,
      maxNodes: 500,
      maxAttempts: 1000,
    },
  }
  const session = FullBookTestSession.parse({ ...initial, input, plan: planFullBookTest(input) })
  // When serializer-aware packing runs before consent.
  const packed = packFullBookTest(session, { threadId: "synthetic-thread", rpcId: 1 })
  // Then every scalar is retained exactly and every actual new map frame fits.
  expect(packed.input.windows.length).toBeGreaterThan(1)
  expect(validBatchPartition(session.input.windows.flat(), packed.input.windows)).toBe(true)
  for (const [window] of packed.input.windows.entries()) {
    const { request } = fullBookTestMapRequest(packed, window)
    const frame = serializeRpcFrame({
      provider: "chatgpt-subscription",
      id: window + 1,
      method: "turn/start",
      params: { threadId: "synthetic-thread", ...localToolInput("chatgpt-subscription", request) },
    })
    expect(frame.bytes).toBeLessThanOrEqual(input.policy.maxAppBytes)
  }
})

it("refuses an indivisible frame instead of looping, truncating or raising an allowance", () => {
  // Given a byte ceiling smaller than the serialization envelope itself.
  const initial = fullBookSession(),
    input = { ...initial.input, policy: { ...initial.input.policy, maxAppBytes: 1 } }
  const session = FullBookTestSession.parse({ ...initial, input, plan: planFullBookTest(input) })
  // When/Then bounded packing refuses at the scalar/envelope boundary.
  expect(() => packFullBookTest(session, { threadId: "synthetic-thread", rpcId: 1 })).toThrow(
    new FullBookTestError("bytes"),
  )
})

it("includes the charged bootstrap frame in a map attempt's byte allowance", () => {
  // Given a valid map whose bootstrap alone consumes the complete app-byte allowance.
  const session = fullBookSession()
  // When/Then packing refuses rather than measuring only the turn frame.
  expect(() =>
    packFullBookTest(session, {
      threadId: "synthetic-thread",
      rpcId: 1,
      setupBytes: session.input.policy.maxAppBytes,
    }),
  ).toThrow(new FullBookTestError("bytes"))
})
