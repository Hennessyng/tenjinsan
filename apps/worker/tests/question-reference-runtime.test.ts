import { afterEach, expect, it } from "vitest"
import { z } from "zod"
import { questionsStage, saveQuestions } from "../src/production-questions.ts"
import { questionIdentityFixture } from "./question-identity-fixture.ts"

const fixtures: ReturnType<typeof questionIdentityFixture>[] = []
afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.close()
})

it("uses a reference-only question wire and refuses a legacy receipt without mutation", () => {
  // Given
  const fixture = questionIdentityFixture()
  fixtures.push(fixture)
  const current = fixture.scope("reference-runtime")
  const { job } = fixture.capture(current, current.draft)
  const before = fixture.storage.counts()
  // When
  const stage = questionsStage(fixture.storage, job)
  const wire = JSON.stringify(z.toJSONSchema(stage.schema, { reused: "ref" }))
  // Then
  expect(wire).toContain('"evidenceRefs"')
  expect(wire).not.toContain('"originalFragment"')
  expect(wire).not.toContain('"revisionId"')
  expect(() => saveQuestions(fixture.storage, job)).toThrow("bank-incompatible")
  expect(fixture.storage.counts()).toEqual(before)
})
