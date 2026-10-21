import { Question } from "@reading-studio/contracts"
import { generateQuestions } from "@reading-studio/generation/questions"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { z } from "zod"
import { persistedQuestionIdentity } from "../src/persisted-question-identity.ts"
import { questionsStage, saveQuestions } from "../src/production-questions.ts"
import { questionIdentityFixture } from "./question-identity-fixture.ts"

const fixtures: ReturnType<typeof questionIdentityFixture>[] = []
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new TypeError("Network forbidden")
    }),
  )
})
afterEach(() => {
  try {
    expect(fetch).not.toHaveBeenCalled()
  } finally {
    vi.restoreAllMocks()
    for (const fixture of fixtures.splice(0)) fixture.close()
    vi.unstubAllGlobals()
  }
})
function given() {
  const fixture = questionIdentityFixture()
  fixtures.push(fixture)
  return fixture
}

it("isolates repeated model IDs across studies/analyses while preserving legacy partial rows and answers", () => {
  // Given
  const { storage, scope, capture, legacy } = given()
  const prior = scope("prior")
  const oldBank = legacy(prior)
  for (const step of oldBank.steps) {
    const option = step.question.options[0]
    if (!option) throw new TypeError("Synthetic option missing")
    storage.interviews.save({
      studyId: prior.setup.studyId,
      interviewId: oldBank.id,
      answer: {
        kind: "choice",
        questionId: step.question.id,
        questionRevisionId: step.question.revisionId,
        optionIds: [option.id],
      },
    })
  }
  const oldAnswers = storage.interviews.answers(oldBank.id)
  const oldRecord = storage.workflow.getQuestion("revision-1")
  const current = scope("current")
  const output = {
    ...current.draft,
    lenses: current.draft.lenses.map((lens, index) => ({
      ...lens,
      revisionId: index === 0 ? "fresh-revision" : lens.revisionId,
    })),
  }
  const partialLens = generateQuestions(current.input, output).lenses[0]
  if (!partialLens) throw new TypeError("Synthetic partial lens missing")
  const partialIdentity = persistedQuestionIdentity({
    setup: current.setup,
    analysisRevisionId: current.analysis.id,
    contextRevisionId: current.input.context.revisionId,
    position: 0,
  })
  const partial = Question.parse({ ...partialLens.question, ...partialIdentity })
  storage.workflow.appendQuestion({ record: partial, parentRevisionId: null })
  const { job } = capture(current, output)
  // When
  expect(() => saveQuestions(storage, job)).not.toThrow()
  const bank = storage.interviews.latest(current.setup.studyId)
  // Then
  expect(bank?.steps).toHaveLength(2)
  expect(
    bank?.steps.every(
      (step) =>
        step.question.analysisRevisionId === current.analysis.id &&
        !oldBank.steps.some((old) => old.question.revisionId === step.question.revisionId),
    ),
  ).toBe(true)
  expect(bank?.shortlist.every((id) => bank.steps.some((step) => step.question.id === id))).toBe(
    true,
  )
  expect(
    bank?.steps.every(
      (step) =>
        !output.lenses.some(
          (lens) => lens.id === step.question.id || lens.revisionId === step.question.revisionId,
        ),
    ),
  ).toBe(true)
  expect(storage.interviews.latest(prior.setup.studyId)).toEqual(oldBank)
  expect(storage.interviews.answers(oldBank.id)).toEqual(oldAnswers)
  expect(storage.workflow.getQuestion("revision-1")).toEqual(oldRecord)
  expect(storage.workflow.getQuestion(partial.revisionId)).toEqual(partial)
  const counts = storage.counts()
  saveQuestions(storage, job)
  expect(storage.counts()).toEqual(counts)
  expect(storage.execution.listAttempts(job.runId)).toHaveLength(1)
})

it("uses separate app-owned identities for different studies sharing a cached analysis", () => {
  // Given
  const { storage, scope, capture } = given()
  const first = scope("prior")
  saveQuestions(storage, capture(first).job)
  const firstBank = storage.interviews.latest(first.setup.studyId)
  const second = scope("shared", true)
  expect(second.analysis.id).toBe(first.analysis.id)
  // When
  saveQuestions(storage, capture(second).job)
  // Then
  const secondBank = storage.interviews.latest(second.setup.studyId)
  expect(
    secondBank?.steps.every(
      (step) =>
        !firstBank?.steps.some(
          (old) =>
            old.question.id === step.question.id ||
            old.question.revisionId === step.question.revisionId,
        ),
    ),
  ).toBe(true)
})

it("recovers partial same-study persistence idempotently from the same durable receipt", () => {
  // Given
  const { storage, scope, capture } = given()
  const current = scope("current")
  const { job } = capture(current)
  vi.spyOn(storage.interviews, "create").mockImplementationOnce(() => {
    throw new TypeError("Synthetic persistence interruption")
  })
  expect(() => saveQuestions(storage, job)).toThrow("Synthetic persistence interruption")
  vi.restoreAllMocks()
  const count = storage.counts().questions
  // When
  saveQuestions(storage, job)
  const bank = storage.interviews.latest(current.setup.studyId)
  saveQuestions(storage, job)
  // Then
  expect(bank?.steps).toHaveLength(2)
  expect(storage.interviews.latest(current.setup.studyId)).toEqual(bank)
  expect(storage.counts().questions).toBe(count)
  expect(storage.execution.listAttempts(job.runId)).toHaveLength(1)
})

it("refuses a genuine same-slot immutable conflict without overwriting or publishing a bank", () => {
  // Given
  const { storage, scope, capture } = given()
  const current = scope("current")
  const first = capture(current)
  const writes: z.infer<typeof Question>[] = []
  const append = storage.workflow.appendQuestion.bind(storage.workflow)
  vi.spyOn(storage.workflow, "appendQuestion").mockImplementation((input) => {
    writes.push(z.object({ record: Question }).parse(input).record)
    return append(input)
  })
  vi.spyOn(storage.interviews, "create").mockImplementationOnce(() => {
    throw new TypeError("Synthetic persistence interruption")
  })
  expect(() => saveQuestions(storage, first.job)).toThrow("Synthetic persistence interruption")
  vi.restoreAllMocks()
  const changed = {
    ...current.draft,
    lenses: current.draft.lenses.map((lens) => ({
      ...lens,
      prompt: { en: "Different content in the same slot", ja: "同じ枠内の異なる内容" },
    })),
  }
  const second = capture(current, changed, { alternate: "questions-conflicting-import" })
  let refusal: unknown
  // When
  try {
    saveQuestions(storage, second.job)
  } catch (error) {
    if (!(error instanceof Error)) throw error
    refusal = error
  }
  // Then
  expect(
    z
      .object({ name: z.literal("ProviderError"), code: z.literal("question-revision-conflict") })
      .safeParse(refusal).success,
  ).toBe(true)
  for (const question of writes)
    expect(storage.workflow.getQuestion(question.revisionId)).toEqual(question)
  expect(storage.interviews.latest(current.setup.studyId)).toBeNull()
})

it("reuses compatible legacy banks and answers without migrating their model IDs", () => {
  // Given
  const { storage, scope, capture, legacy } = given()
  const current = scope("prior")
  const { job } = capture(current)
  const bank = legacy(current)
  const step = bank.steps[0]
  const option = step?.question.options[0]
  if (!step || !option) throw new TypeError("Synthetic legacy choice missing")
  storage.interviews.save({
    studyId: current.setup.studyId,
    interviewId: bank.id,
    answer: {
      kind: "choice",
      questionId: step.question.id,
      questionRevisionId: step.question.revisionId,
      optionIds: [option.id],
    },
  })
  const counts = storage.counts()
  const answers = storage.interviews.answers(bank.id)
  // When
  saveQuestions(storage, job)
  // Then
  expect(storage.interviews.latest(current.setup.studyId)).toEqual(bank)
  expect(storage.interviews.answers(bank.id)).toEqual(answers)
  expect(storage.counts()).toEqual(counts)
})

it("still rejects duplicate wire revision IDs and foreign citations before materialization", () => {
  // Given
  const { storage, scope, capture } = given()
  const current = scope("current")
  const { job } = capture(current)
  // When / Then
  expect(
    questionsStage(storage, job).schema.safeParse({
      ...current.draft,
      lenses: current.draft.lenses.map((lens) => ({ ...lens, revisionId: "duplicate" })),
    }).success,
  ).toBe(false)
  expect(
    questionsStage(storage, job).schema.safeParse({
      ...current.draft,
      lenses: current.draft.lenses.map((lens) => ({
        ...lens,
        sources: lens.sources.map((span) => ({ ...span, blockId: "foreign" })),
      })),
    }).success,
  ).toBe(false)
})
