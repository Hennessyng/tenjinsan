import { afterEach, expect, it } from "vitest"
import { dispatchLocalCodex } from "../src/local-codex-dispatch.ts"
import { validateStageOutput } from "../src/schema-repair.ts"
import {
  closeCodexFixtures,
  type Event,
  given,
  schema,
  wireSchema,
} from "./local-codex-event-fixture.ts"

afterEach(closeCodexFixtures)
const final: Event = { text: '{"answer":"final"}', phase: "final_answer" }
const commentary: Event = { text: "Progress commentary", phase: "commentary" }
const partial: Event = { text: '{"answer":', phase: "partial_answer" }
const legacy: Event = { text: '{"answer":"legacy"}', phase: null }
it.each([
  { name: "commentary after final", items: [final, commentary], expected: final.text },
  { name: "partial after final", items: [final, partial], expected: final.text },
  { name: "legacy after final", items: [final, legacy], expected: final.text },
  {
    name: "commentary only",
    items: [{ ...commentary, text: '{"answer":"not-final"}' }],
    expected: "",
  },
  { name: "partial only", items: [{ ...partial, text: '{"answer":"not-final"}' }], expected: "" },
  {
    name: "legacy fallback",
    items: [{ text: '{"answer":"first"}' }, legacy],
    expected: legacy.text,
  },
  {
    name: "last final",
    items: [{ ...final, text: '{"answer":"first"}' }, final],
    expected: final.text,
  },
  {
    name: "foreign event",
    items: [
      final,
      { ...final, text: "Foreign", threadId: "other-thread" },
      { ...final, text: "Foreign turn", turnId: "other-turn" },
    ],
    expected: final.text,
  },
])("uses terminal answer semantics for $name", async ({ items, expected }) => {
  const { session, request } = await given({ items })
  expect(await dispatchLocalCodex(session, request, () => undefined)).toMatchObject({
    kind: "output",
    text: expected,
    outputFormat: "app-validated-json",
  })
})
it("keeps the final answer when notifications arrive before turn/start acknowledgement", async () => {
  const { session, request } = await given({
    acknowledgeLast: true,
    items: [final, commentary, { text: "Other turn", turnId: "other-turn" }],
  })
  expect(await dispatchLocalCodex(session, request, () => undefined)).toMatchObject({
    kind: "output",
    text: final.text,
  })
})
it.each([
  { label: "plain JSON", text: '{"answer":"ok"}', syntaxInvalid: false, valid: true },
  {
    label: "fenced JSON",
    text: '```json\n{"answer":"ok"}\n```',
    syntaxInvalid: true,
    valid: false,
  },
  { label: "prose wrapper", text: 'Result: {"answer":"ok"}', syntaxInvalid: true, valid: false },
  { label: "truncated JSON", text: '{"answer":"incomplete', syntaxInvalid: true, valid: false },
  {
    label: "two documents",
    text: '{"answer":"one"}\n{"answer":"two"}',
    syntaxInvalid: true,
    valid: false,
  },
  {
    label: "string-encoded JSON",
    text: '"{\\"answer\\":\\"ok\\"}"',
    syntaxInvalid: false,
    valid: false,
  },
  {
    label: "JSON envelope",
    text: '{"result":{"answer":"ok"}}',
    syntaxInvalid: false,
    valid: false,
  },
  {
    label: "invalid final despite valid legacy",
    text: '{"answer":',
    syntaxInvalid: true,
    valid: false,
  },
])(
  "preserves $label bytes and validates without lossy cleanup",
  async ({ text, syntaxInvalid, valid }) => {
    const { session, request } = await given({ items: [legacy, { text, phase: "final_answer" }] })
    const receipt = await dispatchLocalCodex(session, request, () => undefined)
    if (receipt.kind !== "output") throw new TypeError("Expected synthetic output")
    expect(receipt.text).toBe(text)
    const checked = validateStageOutput({ schema, wireSchema, text: receipt.text })
    expect(checked.parsed.success).toBe(valid)
    expect(checked.repair?.issues.some((issue) => issue.code === "invalid-json") ?? false).toBe(
      syntaxInvalid,
    )
  },
)
it("does not treat a closed stream with a final item but no terminal event as received output", async () => {
  const { session, request } = await given({ closeWithoutTerminal: true, items: [final] })
  await expect(dispatchLocalCodex(session, request, () => undefined)).rejects.toMatchObject({
    code: "outcome-unknown",
  })
})
it.each(["final_answer", "future_phase"])(
  "preserves the byte cap for oversized %s output",
  async (phase) => {
    const { session, request } = await given({ items: [{ text: "x".repeat(128001), phase }] })
    await expect(dispatchLocalCodex(session, request, () => undefined)).rejects.toMatchObject({
      code: "outcome-unknown",
    })
  },
)
it.each([
  { phase: "future_phase", acknowledgeLast: false, prefix: [final], suffix: [] },
  { phase: "future_phase", acknowledgeLast: true, prefix: [final], suffix: [] },
  { phase: 7, acknowledgeLast: false, prefix: [final], suffix: [] },
  { phase: "future_phase", acknowledgeLast: false, prefix: [], suffix: [] },
  { phase: "future_phase", acknowledgeLast: false, prefix: [], suffix: [final] },
])(
  "reports unsupported phase as protocol error only after the correlated terminal event: %j",
  async ({ phase, acknowledgeLast, prefix, suffix }) => {
    const { session, request } = await given({
      acknowledgeLast,
      items: [...prefix, { text: "PRIVATE_PROTOCOL_TEXT", phase }, ...suffix],
    })
    const result = await dispatchLocalCodex(session, request, () => undefined)
    expect(result).toEqual({
      kind: "error",
      code: "protocol-error",
      diagnostic: "unsupported-message-phase",
      usage: { kind: "known", inputTokens: 10, outputTokens: 20 },
      outputFormat: "app-validated-json",
      appWire: expect.objectContaining({
        version: "app-rpc-frame-1",
        downstreamInput: "unmeasured",
        frames: expect.arrayContaining([
          expect.objectContaining({ method: "thread/start" }),
          expect.objectContaining({ method: "turn/start" }),
        ]),
      }),
    })
    expect(JSON.stringify(result)).not.toContain("PRIVATE_PROTOCOL_TEXT")
  },
)
it("retains unknown outcome if unsupported phase is followed by stream loss", async () => {
  const { session, request } = await given({
    closeWithoutTerminal: true,
    items: [{ text: "synthetic", phase: "future_phase" }],
  })
  await expect(dispatchLocalCodex(session, request, () => undefined)).rejects.toMatchObject({
    code: "outcome-unknown",
  })
})
it("ignores an unsupported phase from a different turn before acknowledgement", async () => {
  const { session, request } = await given({
    acknowledgeLast: true,
    items: [final, { text: "synthetic", phase: "future_phase", turnId: "other-turn" }],
  })
  expect(await dispatchLocalCodex(session, request, () => undefined)).toMatchObject({
    kind: "output",
    text: final.text,
  })
})
