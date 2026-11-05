import { expect, it } from "vitest"
import { ManagedEventFault, ManagedTurnEvents } from "../src/full-book-managed-events.ts"
import { SubscriptionRpcTrace } from "../src/subscription-rpc-trace.ts"

it.each([false, true])(
  "rejects an empty provided turn before correlation and preserves snapshot state (ack=%s)",
  (acked) => {
    // Given no turn-bearing event has been observed, with or without a legitimate acknowledgement.
    const state = new ManagedTurnEvents("owned", 100),
      trace = new SubscriptionRpcTrace()
    if (acked) state.acknowledge({ turn: { id: "turn", status: "inProgress" } })
    // When/Then the malformed envelope is rejected at its field boundary without manufacturing a seen turn.
    try {
      state.consume("thread/queue/changed", { threadId: "owned", turnId: "" })
      throw new Error("Expected empty-id refusal")
    } catch (error) {
      if (!(error instanceof ManagedEventFault)) throw error
      expect(error.site).toBe("event-envelope")
      expect(error.fields).toEqual(["turnId"])
      expect(
        state.observation({ observation: () => trace.snapshot() }, error.fields),
      ).toMatchObject({
        ack: acked ? "received" : "pending",
        turnSeen: false,
        terminalSeen: false,
        finalSeen: false,
        fields: ["turnId"],
      })
    }
    state.consume("thread/queue/changed", { threadId: "owned", turnId: "turn" })
    expect(state.observation({ observation: () => trace.snapshot() }).turnSeen).toBe(true)
  },
)
it.each([
  { method: "turn/started", acked: false },
  { method: "turn/started", acked: true },
  { method: "turn/completed", acked: false },
  { method: "turn/completed", acked: true },
])(
  "validates nested empty turn ids before correlation: $method, ack=$acked",
  ({ method, acked }) => {
    // Given a nested turn id that cannot identify an owned turn.
    const state = new ManagedTurnEvents("owned", 100),
      trace = new SubscriptionRpcTrace()
    if (acked) state.acknowledge({ turn: { id: "turn", status: "inProgress" } })
    // When/Then parsing fails without altering correlated or terminal state.
    try {
      state.consume(method, { threadId: "owned", turn: { id: "", status: "completed" } })
      throw new Error("Expected empty-id refusal")
    } catch (error) {
      if (!(error instanceof ManagedEventFault)) throw error
      expect(error.site).toBe("terminal-shape")
      expect(error.fields).toEqual(["turn", "id"])
      expect(state.observation({ observation: () => trace.snapshot() })).toMatchObject({
        turnSeen: false,
        terminalSeen: false,
        finalSeen: false,
      })
    }
  },
)
it.each([false, true])(
  "does not install an empty acknowledgement id or status (already acked=%s)",
  (acked) => {
    // Given a malformed acknowledgement before any observed turn.
    const state = new ManagedTurnEvents("owned", 100),
      trace = new SubscriptionRpcTrace()
    if (acked) state.acknowledge({ turn: { id: "turn", status: "inProgress" } })
    // When/Then neither acknowledgement nor correlation is advanced.
    try {
      state.acknowledge({ turn: { id: "", status: "inProgress" } })
      throw new Error("Expected empty-id refusal")
    } catch (error) {
      if (!(error instanceof ManagedEventFault)) throw error
      expect(error.site).toBe("ack-shape")
      expect(error.fields).toEqual(["turn", "id"])
      expect(state.observation({ observation: () => trace.snapshot() })).toMatchObject({
        ack: acked ? "received" : "pending",
        ackStatus: acked ? "inProgress" : "absent",
        turnSeen: false,
      })
    }
  },
)
it("leaves a bare optional absent turn id absent and permits a later legitimate id", () => {
  // Given a schema-valid thread-only invalidation with no turn id.
  const state = new ManagedTurnEvents("owned", 100),
    trace = new SubscriptionRpcTrace()
  // When/Then absence is not fabricated into correlation, and a real id remains usable.
  state.consume("thread/queue/changed", { threadId: "owned" })
  expect(state.observation({ observation: () => trace.snapshot() }).turnSeen).toBe(false)
  state.consume("thread/queue/changed", { threadId: "owned", turnId: "turn" })
  state.acknowledge({ turn: { id: "turn" } })
  expect(state.observation({ observation: () => trace.snapshot() })).toMatchObject({
    ack: "received",
    turnSeen: true,
  })
})
