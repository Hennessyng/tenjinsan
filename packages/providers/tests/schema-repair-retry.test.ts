import { ExternalAttempt } from "@reading-studio/contracts"
import { expect, it } from "vitest"
import { z } from "zod"
import { preparedSchemaRepair } from "../src/schema-repair.ts"

const schema = z.strictObject({ count: z.number() })
const wireSchema = z.toJSONSchema(schema)
const timestamp = "2026-10-21T00:00:00.000Z"
const received = (id: string, reservation: number, retryApproved = false) =>
  ExternalAttempt.parse({
    id,
    runId: "synthetic-run",
    reservation,
    inputRevisionId: "synthetic-input",
    state: "response-received",
    preparedAt: timestamp,
    dispatchedAt: timestamp,
    receivedAt: timestamp,
    responseHash: "a".repeat(64),
    usage: { kind: "known", inputTokens: 1, outputTokens: 1 },
    ...(retryApproved ? { retryApproved: true } : {}),
  })
const prepared = ExternalAttempt.parse({
  id: "prepared",
  runId: "synthetic-run",
  reservation: 3,
  inputRevisionId: "synthetic-input",
  state: "prepared",
  preparedAt: timestamp,
})

it.each(["rate-limited", "unavailable"])(
  "retains invalid-output feedback after %s for an approved retry",
  (code) => {
    // Given
    const output = received("invalid", 1)
    const error = received("error", 2, true)
    const receipts = new Map<string, unknown>([
      [
        output.id,
        {
          kind: "output",
          text: '{"count":"bad"}',
          usage: { kind: "known", inputTokens: 1, outputTokens: 1 },
        },
      ],
      [
        error.id,
        {
          kind: "error",
          code,
          diagnostic: code === "rate-limited" ? "rate-limited" : "provider-unavailable",
          usage: { kind: "known", inputTokens: 1, outputTokens: 1 },
        },
      ],
    ])
    const execution = {
      getAttemptReceipt: (id: string) => {
        const receipt = receipts.get(id)
        return receipt ? new TextEncoder().encode(JSON.stringify(receipt)) : null
      },
    }
    // When
    const explicit = preparedSchemaRepair({
      execution,
      attempts: [output, error],
      schema,
      wireSchema,
    })
    const resumed = preparedSchemaRepair({
      execution,
      attempts: [output, error, prepared],
      schema,
      wireSchema,
    })
    // Then
    const expected = { format: "json-only", issues: [{ code: "invalid_type", path: ["count"] }] }
    expect(explicit).toEqual(expected)
    expect(resumed).toEqual(expected)
  },
)

it("does not inspect an unapproved error receipt", () => {
  // Given
  const execution = {
    getAttemptReceipt: () => {
      throw new TypeError("Unexpected receipt read")
    },
  }
  // When
  const result = preparedSchemaRepair({
    execution,
    attempts: [received("error", 1)],
    schema,
    wireSchema,
  })
  // Then
  expect(result).toBeUndefined()
})
