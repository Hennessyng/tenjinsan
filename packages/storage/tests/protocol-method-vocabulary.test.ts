import { readFileSync } from "node:fs"
import { expect, it } from "vitest"
import { z } from "zod"
import { ManagedDiagnostic } from "../src/full-book-managed-diagnostic.ts"
import { ManagedEventFault, ManagedTurnEvents } from "../src/full-book-managed-events.ts"
import { PINNED_CODEX_NOTIFICATION_METHODS } from "../src/pinned-codex-notification-methods.ts"
import { safeMethod } from "../src/protocol-observation.ts"
import { SubscriptionRpcTrace } from "../src/subscription-rpc-trace.ts"

const fixture = z
  .object({ methods: z.array(z.string()).length(84) })
  .parse(
    JSON.parse(readFileSync(new URL("./pinned-codex-notifications.json", import.meta.url), "utf8")),
  )
it("keeps exactly the pinned public84 names, not a runtime-provided allowlist", () => {
  // Given the independent checked-in public protocol fixture.
  // When/Then production classification is exactly that catalog, without arbitrary additions.
  expect([...PINNED_CODEX_NOTIFICATION_METHODS]).toEqual(fixture.methods)
  expect(new Set(PINNED_CODEX_NOTIFICATION_METHODS).size).toBe(84)
})
function encoded(method: string) {
  const state = new ManagedTurnEvents("owned", 100),
    trace = new SubscriptionRpcTrace()
  try {
    state.consume(method, { threadId: "owned", secret: "PRIVATE_PAYLOAD_SENTINEL" })
  } catch (error) {
    if (!(error instanceof ManagedEventFault)) throw error
  }
  return ManagedDiagnostic.parse(
    JSON.parse(
      JSON.stringify({
        category: "collector",
        stage: "turn-event",
        site: "event-method",
        observation: state.observation({ observation: () => trace.snapshot() }),
      }),
    ),
  )
}
it.each(fixture.methods)(
  "preserves pinned public method %s through diagnostic encoding, not handling authorization",
  (method) => {
    // Given a static public notification name from the pinned protocol, independent of whether policy handles it.
    expect(safeMethod(method)).toBe(method)
    // When/Then the named classification survives the exact diagnostic schema and JSON roundtrip.
    expect(encoded(method)).toMatchObject({ observation: { method } })
  },
)
it("stores only a coarse size bucket for unknown names, never a content hash or secret name", () => {
  // Given two arbitrary private names in the same coarse size bucket.
  const a = encoded("PRIVATE_METHOD_SENTINEL_A"),
    b = encoded("PRIVATE_METHOD_SENTINEL_BB")
  // When/Then no exact length/hash/name/payload oracle is added to the evidence.
  expect(a).toMatchObject({ observation: { method: "other", unknownMethodSize: "1-64" } })
  expect(a).toEqual(b)
  expect(JSON.stringify(a)).not.toContain("SENTINEL")
  expect(JSON.stringify(a)).not.toContain("sha256")
})
it.each(["codex/event", "codex/event/PRIVATE_METHOD_SENTINEL"])(
  "classifies a legacy wrapper without unwrapping payload methods: case %#",
  (method) => {
    // Given a legacy-shaped wrapper outside the public84 catalog.
    // When/Then it remains a rejected wrapper, not a nested method authorization.
    expect(safeMethod(method)).toBe("legacy-codex-event")
    expect(JSON.stringify(encoded(method))).not.toContain("SENTINEL")
  },
)
it("does not route a public-looking nested method out of an unsupported legacy envelope", () => {
  // Given a wrapper carrying an otherwise tolerated method only inside its payload.
  const state = new ManagedTurnEvents("owned", 100)
  // When/Then nested fields never authorize a notification or disclose the nested payload.
  expect(() =>
    state.consume("codex/event", {
      method: "thread/queue/changed",
      params: { threadId: "owned", secret: "PRIVATE_PAYLOAD_SENTINEL" },
    }),
  ).toThrow("event-method")
  const observation = state.observation({
    observation: () => new SubscriptionRpcTrace().snapshot(),
  })
  expect(observation.method).toBe("legacy-codex-event")
  expect(JSON.stringify(observation)).not.toContain("SENTINEL")
})
it("uses a bounded bucket for long unknown names rather than a digest or raw name", () => {
  // Given an arbitrary name beyond the public vocabulary and its normal identifier range.
  const result = encoded("PRIVATE_METHOD_SENTINEL".repeat(20))
  // When/Then only the coarse over-limit bucket survives.
  expect(result).toMatchObject({ observation: { method: "other", unknownMethodSize: "over-256" } })
  expect(JSON.stringify(result)).not.toContain("SENTINEL")
})
