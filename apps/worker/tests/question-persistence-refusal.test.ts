import { generateQuestions } from "@reading-studio/generation/questions"
import { ProviderError } from "@reading-studio/providers"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { questionIdentityFixture } from "./question-identity-fixture.ts"

const fixtures: ReturnType<typeof questionIdentityFixture>[] = []
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new TypeError("Network forbidden")
    }),
  )
  vi.spyOn(console, "info").mockImplementation(() => {})
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
const expired = () => new Date(Date.now() - 240000)

it("marks an incompatible-bank refusal nonretryable and continues other work without dispatch", async () => {
  // Given
  const { storage, scope, capture, local, worker, dispatch } = given()
  const current = scope("current")
  const { job } = capture(current, current.draft, { clock: expired })
  const model = generateQuestions(current.input, current.draft)
  const bank = storage.interviews.create({
    id: "preserved-incompatible-bank",
    studyId: current.setup.studyId,
    analysisRevisionId: current.analysis.id,
    contextRevisionId: "older-context",
    groups: model.groups,
    shortlist: model.shortlist,
    steps: model.lenses.map((lens) => ({
      groupId: lens.groupId,
      purpose: "preference",
      question: lens.question,
    })),
  })
  local(current)
  const runtime = worker()
  // When
  const result = await runtime.runNext()
  const next = await runtime.runNext()
  // Then
  expect(result.kind === "provider" && result.job.state === "failed" && result.job.error.code).toBe(
    "bank-incompatible",
  )
  expect(next.kind).toBe("completed")
  expect(storage.interviews.latest(current.setup.studyId)).toEqual(bank)
  expect(storage.execution.listAttempts(job.runId)).toHaveLength(1)
  expect(dispatch).not.toHaveBeenCalled()
})

it("honors cancellation of an orphan with a known receipt without persisting or redispatching", async () => {
  // Given
  const { storage, scope, capture, worker, dispatch } = given()
  const current = scope("current")
  const { job } = capture(current, current.draft, { clock: expired })
  const attempts = storage.execution.listAttempts(job.runId)
  storage.execution.requestCancellation({ jobId: job.id })
  // When
  await worker().runNext()
  // Then
  expect(storage.execution.getJob(job.id)?.state).toBe("cancelled")
  expect(storage.interviews.latest(current.setup.studyId)).toBeNull()
  expect(storage.execution.listAttempts(job.runId)).toEqual(attempts)
  expect(dispatch).not.toHaveBeenCalled()
})

it("lets cancellation win if it arrives before an expected persistence refusal", async () => {
  // Given
  const { storage, scope, capture, worker, dispatch } = given()
  const current = scope("current")
  const { job } = capture(current, current.draft, { clock: expired })
  const runtime = worker((store, currentJob) => {
    store.execution.requestCancellation({ jobId: currentJob.id })
    throw new ProviderError("bank-incompatible")
  })
  // When
  const result = await runtime.runNext()
  // Then
  expect(result.kind === "provider" && result.job.state).toBe("cancelled")
  expect(storage.execution.getJob(job.id)?.state).toBe("cancelled")
  expect(storage.interviews.latest(current.setup.studyId)).toBeNull()
  expect(dispatch).not.toHaveBeenCalled()
})

it("does not swallow unexpected persistence errors", async () => {
  // Given
  const { scope, capture, worker, dispatch } = given()
  const current = scope("current")
  capture(current, current.draft, { clock: expired })
  // When / Then
  await expect(
    worker(() => {
      throw new TypeError("Synthetic unexpected defect")
    }).runNext(),
  ).rejects.toThrow("Synthetic unexpected defect")
  expect(dispatch).not.toHaveBeenCalled()
})
