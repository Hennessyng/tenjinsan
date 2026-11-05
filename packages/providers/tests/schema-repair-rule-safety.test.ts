import { expect, it } from "vitest"
import { z } from "zod"
import { validateStageOutput } from "../src/schema-repair.ts"

it("retains a recognized constraint rule without reflecting diagnostic text", () => {
  // Given
  const schema = z
    .strictObject({ excludedAreas: z.array(z.string()) })
    .superRefine((draft, context) => {
      if (draft.excludedAreas.length !== 1 || draft.excludedAreas[0] !== "Diagnosis")
        context.addIssue({
          code: "custom",
          path: ["excludedAreas"],
          message: "PRIVATE_DIAGNOSTIC",
          params: { rule: "retain-outline-exclusions" },
        })
    })
  // When
  const result = validateStageOutput({
    schema,
    wireSchema: z.toJSONSchema(schema),
    text: '{"excludedAreas":[]}',
  })
  // Then
  expect(result.parsed.success).toBe(false)
  expect(result.repair).toEqual({
    format: "json-only",
    issues: [{ code: "custom", path: ["excludedAreas"], rule: "retain-outline-exclusions" }],
  })
  expect(JSON.stringify(result.repair)).not.toContain("PRIVATE_DIAGNOSTIC")
})
