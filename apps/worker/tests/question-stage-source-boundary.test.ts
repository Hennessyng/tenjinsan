import { Job } from "@reading-studio/contracts"
import { reviewedSourceBlocks, sourceInput } from "@reading-studio/providers"
import { afterEach, expect, it } from "vitest"
import { questionsStage } from "../src/production-questions.ts"
import { questionIdentityFixture } from "./question-identity-fixture.ts"

const fixtures: ReturnType<typeof questionIdentityFixture>[] = []
afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.close()
})

it("refuses a question job carrying another setup context", () => {
  // Given
  const fixture = questionIdentityFixture()
  fixtures.push(fixture)
  const current = fixture.scope("reference-context")
  const { job } = fixture.capture(current)
  const foreign = Job.parse({ ...job, inputRevisionId: "foreign-synthetic-context" })
  // When / Then
  expect(() => questionsStage(fixture.storage, foreign)).toThrow("unauthorized")
  expect(fixture.storage.interviews.latest(current.setup.studyId)).toBeNull()
})

it("does not append uncited raw ranges beyond approved question evidence", () => {
  // Given
  const fixture = questionIdentityFixture()
  fixtures.push(fixture)
  const current = fixture.scope("reference-source")
  const { job } = fixture.capture(current)
  const normalization = fixture.storage.sources.getNormalization(
    current.setup.analysis.normalizationRevisionId,
  )
  const span = current.analysis.claims[0]?.sources[0]
  if (!normalization || !span) throw new TypeError("Missing synthetic approved evidence")
  const stage = questionsStage(fixture.storage, job)
  // When
  const transmitted = sourceInput(
    reviewedSourceBlocks(current.setup, normalization),
    stage.sourceWindow,
  )
  // Then
  expect(transmitted).toHaveLength(1)
  expect(transmitted[0]).toMatchObject({
    blockId: span.blockId,
    start: span.start,
    end: span.end,
    text: span.originalFragment,
  })
})
