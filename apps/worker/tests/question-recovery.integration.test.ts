import { queueQuestions } from "@reading-studio/generation/queue-questions"
import { savedSetupDecision } from "@reading-studio/server/study-setup-send"
import { afterEach, expect, it, vi } from "vitest"
import { runProductionWorker } from "../src/production-runtime.ts"
import { questionHandoffFixture } from "./question-handoff-fixture.ts"

const fixtures: Awaited<ReturnType<typeof questionHandoffFixture>>[] = []
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})
async function given() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new TypeError("Network forbidden")
    }),
  )
  const fixture = await questionHandoffFixture(true)
  fixtures.push(fixture)
  const { storage, setup, grant, pipeline } = fixture
  queueQuestions(storage, setup.id, grant.id, pipeline.prepare(setup.id, grant.id))
  return fixture
}

it("recovers a crash after the questions receipt and before bank persistence with no second attempt", async () => {
  // Given
  const { storage, setup, worker } = await given()
  const persistence = vi.spyOn(storage.interviews, "create").mockImplementationOnce(() => {
    throw new TypeError("Synthetic persistence interruption")
  })
  await expect(worker(true, () => new Date(Date.now() - 240000)).runNext()).rejects.toThrow(
    "Synthetic persistence interruption",
  )
  persistence.mockRestore()
  const job = storage.execution.listSetupJobs(setup.id)[0]
  if (!job) throw new TypeError("Synthetic job missing")
  const attempts = storage.execution.listAttempts(job.runId)
  expect(attempts.map((attempt) => attempt.state)).toEqual(["response-received"])
  // When
  const stop = new AbortController()
  const running = runProductionWorker(stop.signal)
  try {
    await vi.waitFor(
      () => expect(storage.interviews.latest(setup.studyId)?.steps).toHaveLength(1),
      { timeout: 8000 },
    )
  } finally {
    stop.abort()
    await running
  }
  // Then
  expect(storage.execution.listAttempts(job.runId)).toEqual(attempts)
  expect(storage.execution.getJob(job.id)?.state).toBe("completed")
  expect(storage.counts().questions).toBe(1)
})

it("retains an unknown external questions outcome for explicit resolution on normal startup", async () => {
  // Given
  const { storage, setup, worker } = await given()
  const now = new Date().toISOString()
  const job = storage.execution.claimNextJob({
    token: "synthetic-lease",
    now,
    expiresAt: new Date(Date.now() + 120000).toISOString(),
  })
  if (job?.state !== "running") throw new TypeError("Synthetic claim missing")
  const lease = { jobId: job.id, token: job.lease.token, fence: job.lease.fence, now }
  storage.execution.reserveAttempt({
    ...lease,
    attemptId: "unknown-question-attempt",
    preparedAt: now,
  })
  storage.execution.markAttemptDispatching({
    ...lease,
    attemptId: "unknown-question-attempt",
    dispatchedAt: now,
  })
  storage.execution.pauseUnknownProviderJob(lease)
  const before = storage.execution.listAttempts(job.runId)
  // When
  await runProductionWorker(AbortSignal.abort())
  const next = await worker().runNext()
  // Then
  expect(next.kind).toBe("idle")
  expect(storage.execution.listAttempts(job.runId)).toEqual(before)
  expect(storage.execution.getJob(job.id)).toMatchObject({
    state: "paused",
    reason: "outcome_unknown",
  })
  expect(storage.interviews.latest(setup.studyId)).toBeNull()
  expect(savedSetupDecision(storage, setup, job.grant.id)).toMatchObject({
    analysisProgress: "questions-unknown",
    canResume: false,
  })
})

it("reuses a compatible bank and preserves its answer through repeated recovery", async () => {
  // Given
  const { storage, setup, grant, pipeline, worker } = await given()
  await worker().runNext()
  const bank = storage.interviews.latest(setup.studyId)
  const question = bank?.steps[0]?.question
  const option = question?.options[0]
  if (!bank || !question || !option) throw new TypeError("Synthetic saved bank missing")
  storage.interviews.save({
    studyId: setup.studyId,
    interviewId: bank.id,
    answer: {
      kind: "choice",
      questionId: question.id,
      questionRevisionId: question.revisionId,
      optionIds: [option.id],
    },
  })
  const answers = storage.interviews.answers(bank.id)
  const counts = storage.counts()
  // When
  queueQuestions(storage, setup.id, grant.id, pipeline.prepare(setup.id, grant.id))
  await runProductionWorker(AbortSignal.abort())
  await runProductionWorker(AbortSignal.abort())
  // Then
  expect(storage.interviews.latest(setup.studyId)).toEqual(bank)
  expect(storage.interviews.answers(bank.id)).toEqual(answers)
  expect(storage.counts()).toEqual(counts)
})
