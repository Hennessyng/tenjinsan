import { expect, it } from "vitest"
import { ManagedDiagnostic } from "../src/full-book-managed-diagnostic.ts"
import { ManagedEventFault, ManagedTurnEvents } from "../src/full-book-managed-events.ts"
import { safeServerError } from "../src/protocol-server-error.ts"
import { SubscriptionRpcTrace } from "../src/subscription-rpc-trace.ts"

const item = (type: string, extra: object = {}) => ({
  threadId: "thread",
  turnId: "turn",
  item: { type, ...extra },
})
const final = item("agentMessage", { text: "{}", phase: "final_answer" })
const terminal = {
  threadId: "thread",
  turn: { id: "turn", status: "completed", items: [], error: null },
}
const cases = [
  ["event-envelope", (s: ManagedTurnEvents) => s.consume("item/completed", null)],
  [
    "event-thread",
    (s: ManagedTurnEvents) => s.consume("item/completed", { ...final, threadId: "foreign" }),
  ],
  [
    "event-turn",
    (s: ManagedTurnEvents) => {
      s.acknowledge({ turn: { id: "owned" } })
      s.consume("item/completed", final)
    },
  ],
  [
    "event-method",
    (s: ManagedTurnEvents) => s.consume("SECRET_METHOD", { secret: "SECRET_VALUE" }),
  ],
  [
    "error-shape",
    (s: ManagedTurnEvents) => s.consume("error", { threadId: "thread", turnId: "turn" }),
  ],
  [
    "server-error",
    (s: ManagedTurnEvents) =>
      s.consume("error", {
        threadId: "thread",
        turnId: "turn",
        willRetry: true,
        error: { message: "SECRET_MESSAGE", codexErrorInfo: "rateLimitExceeded" },
      }),
  ],
  [
    "summary-shape",
    (s: ManagedTurnEvents) =>
      s.consume("item/reasoning/summaryPartAdded", {
        threadId: "thread",
        turnId: "turn",
        itemId: "r",
        summaryIndex: null,
      }),
  ],
  [
    "usage-shape",
    (s: ManagedTurnEvents) =>
      s.consume("thread/tokenUsage/updated", { threadId: "thread", tokenUsage: null }),
  ],
  [
    "item-shape",
    (s: ManagedTurnEvents) =>
      s.consume("item/completed", { threadId: "thread", item: { type: "agentMessage" } }),
  ],
  ["item-kind", (s: ManagedTurnEvents) => s.consume("item/completed", item("commandExecution"))],
  [
    "user-item-shape",
    (s: ManagedTurnEvents) =>
      s.consume(
        "item/completed",
        item("userMessage", { id: "input", content: [{ type: "image", url: "SECRET_VALUE" }] }),
      ),
  ],
  [
    "agent-empty",
    (s: ManagedTurnEvents) =>
      s.consume("item/completed", item("agentMessage", { text: "", phase: "final_answer" })),
  ],
  [
    "agent-phase",
    (s: ManagedTurnEvents) =>
      s.consume("item/completed", item("agentMessage", { text: "{}", phase: null })),
  ],
  [
    "agent-duplicate",
    (s: ManagedTurnEvents) => {
      s.consume("item/completed", final)
      s.consume("item/completed", final)
    },
  ],
  [
    "terminal-shape",
    (s: ManagedTurnEvents) => s.consume("turn/completed", { threadId: "thread", turn: null }),
  ],
  [
    "terminal-status",
    (s: ManagedTurnEvents) =>
      s.consume("turn/completed", { ...terminal, turn: { id: "turn", status: "interrupted" } }),
  ],
  [
    "terminal-missing-final",
    (s: ManagedTurnEvents) => {
      s.acknowledge({ turn: { id: "turn" } })
      s.consume("turn/completed", terminal)
      s.complete(false)
    },
  ],
  [
    "client-request",
    (s: ManagedTurnEvents) => {
      s.acknowledge({ turn: { id: "turn" } })
      s.consume("item/completed", final)
      s.consume("turn/completed", terminal)
      s.complete(true)
    },
  ],
  ["ack-shape", (s: ManagedTurnEvents) => s.acknowledge({ turn: null })],
] as const
it.each(cases)("distinguishes %s and saves only bounded observation metadata", (site, action) => {
  // Given one parser or state-machine failure site, independent of process scheduling.
  const s = new ManagedTurnEvents("thread", 100),
    trace = new SubscriptionRpcTrace()
  // When/Then the site and safe field paths survive without arbitrary values or method names.
  try {
    action(s)
    throw new Error("Expected a fault")
  } catch (error) {
    if (!(error instanceof ManagedEventFault)) throw error
    expect(error.site).toBe(site)
    const diagnostic = ManagedDiagnostic.parse({
      category: "collector",
      stage: "turn-event",
      site,
      observation: s.observation({ observation: () => trace.snapshot() }, error.fields),
    })
    expect(JSON.stringify(diagnostic)).not.toContain("SECRET")
  }
})
it.each(["before", "after"])(
  "correlates a complete response %s turn acknowledgement",
  (ordering) => {
    // Given supported ordering around a deferred JSON-RPC acknowledgement.
    const s = new ManagedTurnEvents("thread", 100)
    if (ordering === "before") s.acknowledge({ turn: { id: "turn" } })
    // When final and terminal notifications arrive, then either acknowledgement ordering is supported.
    s.consume("item/completed", final)
    s.consume("turn/completed", terminal)
    if (ordering === "after") s.acknowledge({ turn: { id: "turn" } })
    expect(s.complete(false)).toBe(true)
  },
)
it("rejects a foreign pre-ack input echo at acknowledgement without retaining content", () => {
  // Given a foreign turn's input echo before the reply promise settles.
  const s = new ManagedTurnEvents("thread", 100)
  s.consume(
    "item/completed",
    item("userMessage", { id: "input", content: [{ type: "text", text: "SECRET_VALUE" }] }),
  )
  // When/Then the acknowledgement must match the already observed turn.
  expect(() => s.acknowledge({ turn: { id: "foreign" } })).toThrow("event-turn")
})
it("distinguishes the collection limit from parser failures", () => {
  // Given output beyond the unchanged application collection bound.
  const s = new ManagedTurnEvents("thread", 1)
  // When/Then collection fails without treating that output as accepted.
  expect(() => s.consume("item/completed", final)).toThrow("collection-limit")
})
it("retains a pinned HTTP error variant and code but not server details", () => {
  // Given a known server error discriminant with untrusted additional details.
  const raw = { responseStreamDisconnected: { httpStatusCode: 429, secret: "SECRET_VALUE" } }
  // When/Then only known code/status fields cross the diagnostic boundary.
  expect(safeServerError(raw)).toEqual({ code: "responseStreamDisconnected", httpStatus: 429 })
  expect(safeServerError("SECRET_VALUE")).toEqual({ code: "other" })
})
it.each([
  "thread/settings/updated",
  "modelProvider/authRecoveryStarted",
  "account/updated",
  "thread/realtime/started",
  "mcpServer/startupStatus/updated",
  "process/outputDelta",
])("does not turn named classification into acceptance: %s", (method) => {
  // Given a public name outside the deliberately supported metadata/output projection.
  const state = new ManagedTurnEvents("thread", 100)
  // When/Then configuration, auth, tools and unrelated modes remain fail-closed.
  expect(() => state.consume(method, { threadId: "thread" })).toThrow("event-method")
})
it("rejects an empty scoped turn id instead of treating it as no correlation", () => {
  // Given an explicit but empty turn id on the otherwise passive queue signal.
  const state = new ManagedTurnEvents("thread", 100)
  // When/Then an absent identity and a malformed provided identity are not equivalent.
  expect(() => state.consume("thread/queue/changed", { threadId: "thread", turnId: "" })).toThrow(
    "event-envelope",
  )
})
