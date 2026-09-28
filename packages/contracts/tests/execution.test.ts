import { expect, it } from "vitest"
import { ExternalAttempt, GenerationRun, RunBudget } from "../src/index.ts"

it("exposes bounded default run policy", () => {
  const result = RunBudget.parse({})
  expect(result).toEqual({
    maxCalls: 64,
    maxSourceCharacters: 32000,
    maxOutputTokens: 6000,
    maxTransientRetries: 2,
    maxSchemaRepairs: 1,
  })
})
it.each(["prepared", "dispatching", "response-received", "outcome_unknown"])(
  "accepts durable attempt state %s with its required receipt",
  (state) => {
    const given = {
      id: "attempt-1",
      runId: "run-1",
      reservation: 1,
      inputRevisionId: "input-1",
      state,
      preparedAt: "2026-09-18T00:00:00Z",
      ...(state === "prepared" ? {} : { dispatchedAt: "2026-09-18T00:00:01Z" }),
      ...(state === "response-received"
        ? {
            responseHash: "a".repeat(64),
            receivedAt: "2026-09-18T00:00:02Z",
            usage: { kind: "known", inputTokens: 10, outputTokens: 20 },
          }
        : {}),
      ...(state === "outcome_unknown"
        ? { usage: { kind: "unknown" }, resolution: "awaiting-owner" }
        : {}),
    }
    const result = ExternalAttempt.safeParse(given)
    expect(result.success).toBe(true)
  },
)
it("rejects exhausted budget with a reserved slot beyond the limit", () => {
  const result = GenerationRun.safeParse({
    id: "run-1",
    inputRevisionId: "input-1",
    budget: { maxCalls: 1 },
    reservedCalls: 2,
    state: "running",
  })
  expect(result.success).toBe(false)
})
it("rejects unknown outcome claiming zero usage", () => {
  const result = ExternalAttempt.safeParse({
    id: "attempt-1",
    runId: "run-1",
    reservation: 1,
    inputRevisionId: "input-1",
    state: "outcome_unknown",
    preparedAt: "2026-09-18T00:00:00Z",
    dispatchedAt: "2026-09-18T00:00:01Z",
    usage: { kind: "known", inputTokens: 0, outputTokens: 0 },
    resolution: "awaiting-owner",
  })
  expect(result.success).toBe(false)
})
