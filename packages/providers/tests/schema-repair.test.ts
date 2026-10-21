import { expect, it } from "vitest"
import { z } from "zod"
import { defaultSettings } from "../src/catalog.ts"
import { localRequestBytes, localToolInput } from "../src/local-tool-request.ts"
import { validateStageOutput } from "../src/schema-repair.ts"
import { structuredRequest } from "../src/structured-request.ts"

it("keeps dynamic keys and native messages out of bounded repair metadata", () => {
  // Given
  const schema = z.record(z.string(), z.strictObject({ count: z.number() }))
  const value = Object.fromEntries(
    Array.from({ length: 12 }, (_, index) => [
      `NATIVE_DIAGNOSTIC_SENTINEL_${index}`,
      { count: "invalid" },
    ]),
  )
  // When
  const result = validateStageOutput({
    schema,
    wireSchema: z.toJSONSchema(schema),
    text: JSON.stringify(value),
  })
  // Then
  expect(result.parsed.success).toBe(false)
  expect(result.repair?.issues).toHaveLength(8)
  expect(
    result.repair?.issues.every(
      (issue) =>
        issue.code === "invalid_type" &&
        JSON.stringify(issue.path) === JSON.stringify(["[field]", "count"]),
    ),
  ).toBe(true)
  expect(JSON.stringify(result.repair)).not.toContain("NATIVE_DIAGNOSTIC_SENTINEL")
})

it("limits path depth and discards unrecognized custom-rule data", () => {
  // Given
  const schema = z.strictObject({ count: z.number() }).superRefine((_value, context) => {
    context.addIssue({
      code: "custom",
      path: Array.from({ length: 30 }, () => "NATIVE_PATH_SENTINEL"),
      message: "NATIVE_MESSAGE_SENTINEL",
      params: { rule: "NATIVE_RULE_SENTINEL" },
    })
  })
  // When
  const result = validateStageOutput({
    schema,
    wireSchema: z.toJSONSchema(schema),
    text: '{"count":1}',
  })
  // Then
  expect(result.parsed.success).toBe(false)
  expect(result.repair?.issues[0]?.path).toHaveLength(16)
  expect(result.repair?.issues[0]?.rule).toBeUndefined()
  expect(JSON.stringify(result.repair)).not.toContain("NATIVE_")
})

it("reports invalid JSON without repairing or accepting the output text", () => {
  // Given
  const schema = z.strictObject({ count: z.number() })
  // When
  const result = validateStageOutput({
    schema,
    wireSchema: z.toJSONSchema(schema),
    text: '{"count":[1 2]}',
  })
  // Then
  expect(result.parsed.success).toBe(false)
  expect(result.repair).toEqual({
    format: "json-only",
    issues: [{ code: "invalid-json", path: [] }],
  })
})

it("puts only structured repair data on the ChatGPT app-validated wire and measures it", () => {
  // Given
  const schema = z.strictObject({ count: z.number(), note: z.string().optional() })
  const wireSchema = z.toJSONSchema(schema)
  const validation = validateStageOutput({ schema, wireSchema, text: '{"count":"invalid"}' })
  if (!validation.repair) throw new TypeError("Synthetic repair metadata missing")
  const input = {
    model: "study-model",
    settings: defaultSettings,
    instruction: "Synthetic fixture",
    blocks: [],
    schema: wireSchema,
    signal: new AbortController().signal,
  }
  const base = structuredRequest(input)
  // When
  const request = structuredRequest({ ...input, schemaRepair: validation.repair })
  const payload = z
    .object({ input: z.array(z.object({ text: z.string() })) })
    .parse(localToolInput("chatgpt-subscription", request))
  const lines = payload.input[0]?.text.split("\n")
  if (!lines?.[0] || !lines[1]) throw new TypeError("Synthetic ChatGPT wire lines missing")
  // Then
  expect(JSON.parse(lines[0])).toEqual({ responseSchema: wireSchema })
  expect(JSON.parse(lines[1])).toEqual({
    schemaRepair: { format: "json-only", issues: [{ code: "invalid_type", path: ["count"] }] },
  })
  expect(localRequestBytes("chatgpt-subscription", request)).toBeGreaterThan(
    localRequestBytes("chatgpt-subscription", base),
  )
})
