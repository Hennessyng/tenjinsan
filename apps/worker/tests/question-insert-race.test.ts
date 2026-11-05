import { Question } from "@reading-studio/contracts"
import { afterEach, expect, it, vi } from "vitest"
import { z } from "zod"
import { saveQuestions } from "../src/production-questions.ts"
import { questionIdentityFixture } from "./question-identity-fixture.ts"

const fixtures: ReturnType<typeof questionIdentityFixture>[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const fixture of fixtures.splice(0)) fixture.close()
  vi.unstubAllGlobals()
})

it.each([false, true])(
  "handles competing immutable question inserts (conflicting: %s)",
  (conflicting) => {
    // Given
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new TypeError("Network forbidden")
      }),
    )
    const fixture = questionIdentityFixture()
    fixtures.push(fixture)
    const current = fixture.scope("synthetic-race")
    const { job } = fixture.capture(current)
    const attempts = fixture.storage.execution.listAttempts(job.runId)
    const append = fixture.storage.workflow.appendQuestion.bind(fixture.storage.workflow)
    let competing: Question | undefined
    vi.spyOn(fixture.storage.workflow, "appendQuestion").mockImplementationOnce((input) => {
      const { record } = z.object({ record: Question }).parse(input)
      competing = conflicting
        ? Question.parse({ ...record, prompt: { en: "Other content", ja: "別の内容" } })
        : record
      append({ record: competing, parentRevisionId: null })
      return append(input)
    })
    // When / Then
    if (conflicting)
      expect(() => saveQuestions(fixture.storage, job)).toThrowError(
        expect.objectContaining({ code: "question-revision-conflict" }),
      )
    else expect(() => saveQuestions(fixture.storage, job)).not.toThrow()
    if (!competing) throw new TypeError("Synthetic race did not execute")
    expect(fixture.storage.workflow.getQuestion(competing.revisionId)).toEqual(competing)
    expect(fixture.storage.interviews.latest(current.setup.studyId)?.steps.length ?? 0).toBe(
      conflicting ? 0 : 2,
    )
    expect(fixture.storage.execution.listAttempts(job.runId)).toEqual(attempts)
    expect(fetch).not.toHaveBeenCalled()
  },
)
