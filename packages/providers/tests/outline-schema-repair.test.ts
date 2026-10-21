import { expect, it } from "vitest"
import { z } from "zod"
import { validateStageOutput } from "../src/schema-repair.ts"

const shape = z.strictObject({
  qualifications: z.array(z.strictObject({ id: z.string() })),
  excludedAreas: z.array(z.string()),
  sections: z.array(z.strictObject({ questionIndex: z.number() })),
  lenses: z.array(z.strictObject({ revisionId: z.string() })),
})
const value = {
  qualifications: [{ id: "NATIVE_VALUE_SENTINEL" }],
  excludedAreas: [],
  sections: [{ questionIndex: 1 }],
  lenses: [{ revisionId: "NATIVE_REVISION_SENTINEL" }, { revisionId: "NATIVE_REVISION_SENTINEL" }],
}

it.each([
  { rule: "retain-outline-qualifications", path: ["qualifications", 0, "id"] },
  { rule: "retain-outline-exclusions", path: ["excludedAreas"] },
  { rule: "approved-outline-question-index", path: ["sections", 0, "questionIndex"] },
  { rule: "unique-question-revision-id", path: ["lenses", 1, "revisionId"] },
])(
  "carries the fixed schema-owned $rule rule without native values or messages",
  ({ rule, path }) => {
    // Given
    const schema = shape.superRefine((_output, context) =>
      context.addIssue({
        code: "custom",
        path,
        message: "NATIVE_MESSAGE_SENTINEL",
        params: { rule },
      }),
    )
    // When
    const result = validateStageOutput({
      schema,
      wireSchema: z.toJSONSchema(schema),
      text: JSON.stringify(value),
    })
    // Then
    expect(result.parsed.success).toBe(false)
    expect(result.repair).toEqual({ format: "json-only", issues: [{ code: "custom", path, rule }] })
    expect(JSON.stringify(result.repair)).not.toContain("NATIVE_")
  },
)

it("does not admit native or near-matching rule names and retains privacy bounds", () => {
  // Given
  const schema = shape.superRefine((_output, context) => {
    for (let index = 0; index < 12; index += 1)
      context.addIssue({
        code: "custom",
        path: Array.from({ length: 30 }, () => "NATIVE_PATH_SENTINEL"),
        message: "NATIVE_MESSAGE_SENTINEL",
        params: {
          rule:
            index % 2
              ? "retain-outline-qualifications:NATIVE_RULE_SENTINEL"
              : "NATIVE_RULE_SENTINEL",
        },
      })
  })
  // When
  const result = validateStageOutput({
    schema,
    wireSchema: z.toJSONSchema(schema),
    text: JSON.stringify(value),
  })
  // Then
  expect(result.repair?.issues).toHaveLength(8)
  expect(
    result.repair?.issues.every((issue) => issue.path.length === 16 && issue.rule === undefined),
  ).toBe(true)
  expect(JSON.stringify(result.repair)).not.toContain("NATIVE_")
})
