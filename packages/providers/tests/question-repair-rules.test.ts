import { expect, it } from "vitest"
import { z } from "zod"
import { validateStageOutput } from "../src/schema-repair.ts"

it.each([
  "approved-question-reference",
  "approved-question-binding",
  "question-choice-contract",
] as const)("retains bounded %s repair rules without diagnostic text", (rule) => {
  // Given
  const schema = z.strictObject({ value: z.string() }).superRefine((_value, context) => {
    context.addIssue({
      code: "custom",
      path: ["value"],
      message: "PRIVATE_DIAGNOSTIC",
      params: { rule },
    })
  })
  // When
  const result = validateStageOutput({
    schema,
    wireSchema: z.toJSONSchema(schema),
    text: '{"value":"synthetic"}',
  })
  // Then
  expect(result.repair).toEqual({
    format: "json-only",
    issues: [{ code: "custom", path: ["value"], rule }],
  })
  expect(JSON.stringify(result.repair)).not.toContain("PRIVATE_DIAGNOSTIC")
})
