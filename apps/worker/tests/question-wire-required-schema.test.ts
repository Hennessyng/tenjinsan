import { afterEach, expect, it } from "vitest"
import { z } from "zod"
import { questionsStage } from "../src/production-questions.ts"
import { questionIdentityFixture } from "./question-identity-fixture.ts"

const fixtures: ReturnType<typeof questionIdentityFixture>[] = []
afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.close()
})

function strictObjects(value: unknown): boolean {
  if (Array.isArray(value)) return value.every(strictObjects)
  const parsed = z.record(z.string(), z.unknown()).safeParse(value)
  if (!parsed.success) return true
  const node = parsed.data
  const properties = z.record(z.string(), z.unknown()).safeParse(node["properties"])
  if (properties.success) {
    const required = z.array(z.string()).safeParse(node["required"])
    if (
      node["additionalProperties"] !== false ||
      !required.success ||
      Object.keys(properties.data).some((key) => !required.data.includes(key))
    )
      return false
  }
  return Object.values(node).every(strictObjects)
}

it("exports a strict required-only question wire without quote or revision fields", () => {
  // Given
  const fixture = questionIdentityFixture()
  fixtures.push(fixture)
  const current = fixture.scope("required-wire")
  const { job } = fixture.capture(current)
  // When
  const schema = z.toJSONSchema(questionsStage(fixture.storage, job).schema, { reused: "ref" })
  const wire = JSON.stringify(schema)
  // Then
  expect(wire).toContain('"evidenceRefs"')
  expect(wire).not.toContain('"originalFragment"')
  expect(wire).not.toContain('"pageLabel"')
  expect(wire).not.toContain('"revisionId"')
  expect(strictObjects(schema)).toBe(true)
})
