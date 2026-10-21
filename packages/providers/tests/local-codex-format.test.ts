import { expect, it } from "vitest"
import { z } from "zod"
import { codexTerminalFailure } from "../src/local-codex-error.ts"
import { codexOutputFormat } from "../src/local-codex-schema.ts"
import { localToolInput } from "../src/local-tool-request.ts"

it("keeps native schema mode for required-field shapes", () => {
  // Given
  const schema = z.toJSONSchema(z.strictObject({ answer: z.string() }))
  // When
  const mode = codexOutputFormat(schema)
  // Then
  expect(mode).toBe("native-json-schema")
})

it("preserves the original optional-field schema as app-validated guidance through references", () => {
  // Given
  const schema = {
    type: "object",
    properties: { source: { $ref: "#/$defs/source" } },
    required: ["source"],
    additionalProperties: false,
    $defs: {
      source: {
        type: "object",
        properties: { text: { type: "string" }, page: { type: "string" } },
        required: ["text"],
        additionalProperties: false,
      },
    },
  }
  const input = {
    model: "fixture-model",
    prompt: "fixture-input",
    schema,
    settings: {
      temperature: 0,
      topP: 1,
      maxOutputTokens: 128,
      seed: null,
      reasoningEffort: "default",
    } as const,
    signal: new AbortController().signal,
  }
  // When
  const wire = z
    .object({
      model: z.string(),
      input: z.array(z.object({ text: z.string() })),
      outputSchema: z.unknown().optional(),
    })
    .parse(localToolInput("chatgpt-subscription", input))
  // Then
  expect(wire.outputSchema).toBeUndefined()
  expect(wire.model).toBe(input.model)
  const first = wire.input[0]
  if (!first) throw new TypeError("Missing fixture input")
  expect(
    z.object({ responseSchema: z.unknown() }).parse(JSON.parse(first.text.split("\n")[0] ?? ""))
      .responseSchema,
  ).toEqual(schema)
  expect(schema.$defs.source.required).toEqual(["text"])
})

it.each([
  { info: "badRequest", expected: { code: "rejected", diagnostic: "request-rejected" } },
  { info: "unauthorized", expected: { code: "rejected", diagnostic: "access-rejected" } },
  { info: "usageLimitExceeded", expected: { code: "rate-limited", diagnostic: "rate-limited" } },
  {
    info: "serverOverloaded",
    expected: { code: "unavailable", diagnostic: "provider-unavailable" },
  },
  {
    info: { httpConnectionFailed: { httpStatusCode: 400 } },
    expected: { code: "rejected", diagnostic: "request-rejected" },
  },
  {
    info: { httpConnectionFailed: { httpStatusCode: 503 } },
    expected: { code: "unavailable", diagnostic: "transport-failure" },
  },
  {
    info: { message: "PRIVATE_DIAGNOSTIC_SENTINEL" },
    expected: { code: "unavailable", diagnostic: "terminal-unclassified" },
  },
])(
  "keeps native failure classification bounded without copying messages: case %#",
  ({ info, expected }) => {
    // Given: the table supplies a native classification and expected safe category.
    // When
    const result = codexTerminalFailure(info, false)
    // Then
    expect(result).toEqual(expected)
    expect(JSON.stringify(result).includes("PRIVATE_DIAGNOSTIC_SENTINEL")).toBe(false)
  },
)

it("reports a denied client capability separately from provider availability", () => {
  // Given
  const info = "serverOverloaded"
  // When
  const result = codexTerminalFailure(info, true)
  // Then
  expect(result).toEqual({ code: "rejected", diagnostic: "client-capability-denied" })
})
