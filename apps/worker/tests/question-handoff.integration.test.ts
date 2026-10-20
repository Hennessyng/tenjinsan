import { queueQuestions } from "@reading-studio/generation/queue-questions"
import { afterEach, expect, it, vi } from "vitest"
import { questionsStage, saveQuestions } from "../src/production-questions.ts"
import { runProductionWorker } from "../src/production-runtime.ts"
import { questionHandoffFixture } from "./question-handoff-fixture.ts"

const fixtures: Awaited<ReturnType<typeof questionHandoffFixture>>[] = []
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})
async function given(cached = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new TypeError("Network forbidden")
    }),
  )
  const fixture = await questionHandoffFixture(cached)
  fixtures.push(fixture)
  return fixture
}

it.each([false, true])(
  "normal startup resumes a consented handoff (cached=%s) without duplicate work",
  async (cached) => {
    // Given
    const { storage, setup } = await given(cached)
    const stop = new AbortController()
    // When
    const running = runProductionWorker(stop.signal)
    try {
      await vi.waitFor(
        () =>
          expect(storage.interviews.latest(setup.studyId)?.steps[0]?.question.options).toHaveLength(
            2,
          ),
        { timeout: 8000 },
      )
    } finally {
      stop.abort()
      await running
    }
    const before = storage.execution.listSetupJobs(setup.id)
    await runProductionWorker(AbortSignal.abort())
    // Then
    expect(storage.execution.listSetupJobs(setup.id)).toEqual(before)
    expect(before.filter((job) => job.stage === "analysis")).toHaveLength(cached ? 0 : 1)
    expect(before.filter((job) => job.stage === "questions")).toHaveLength(1)
    expect(before.every((job) => job.state === "completed")).toBe(true)
    expect(before.flatMap((job) => storage.execution.listAttempts(job.runId))).toHaveLength(
      cached ? 1 : 2,
    )
    expect(fetch).not.toHaveBeenCalled()
  },
  12000,
)

it("normal startup saves a completed questions receipt without another provider attempt", async () => {
  // Given
  const { storage, setup, grant, pipeline, worker } = await given()
  queueQuestions(storage, setup.id, grant.id, pipeline.prepare(setup.id, grant.id))
  await worker(false).runNext()
  expect(storage.interviews.latest(setup.studyId)).toBeNull()
  const jobs = storage.execution.listSetupJobs(setup.id)
  // When
  await runProductionWorker(AbortSignal.abort())
  await runProductionWorker(AbortSignal.abort())
  // Then
  expect(storage.interviews.latest(setup.studyId)?.steps[0]?.question.options).toHaveLength(2)
  expect(storage.execution.listSetupJobs(setup.id)).toEqual(jobs)
  expect(jobs.flatMap((job) => storage.execution.listAttempts(job.runId))).toHaveLength(1)
})

it("preserves an incompatible bank and its saved answer instead of silently accepting another context", async () => {
  // Given
  const { storage, setup, grant, pipeline, fixture } = await given()
  const analysis = pipeline.prepare(setup.id, grant.id)
  const bank = storage.interviews.create({
    id: "retained-bank",
    studyId: setup.studyId,
    analysisRevisionId: analysis.id,
    contextRevisionId: "older-context",
    groups: [{ id: "focus", label: { en: "Focus", ja: "焦点" } }],
    shortlist: [fixture.question.id],
    steps: [{ groupId: "focus", purpose: "preference", question: fixture.question }],
  })
  storage.interviews.save({
    studyId: setup.studyId,
    interviewId: bank.id,
    answer: fixture.submission.answer,
  })
  const answers = storage.interviews.answers(bank.id)
  // When / Then
  expect(() => queueQuestions(storage, setup.id, grant.id, analysis)).toThrow(/incompatible/i)
  expect(storage.interviews.latest(setup.studyId)).toEqual(bank)
  expect(storage.interviews.answers(bank.id)).toEqual(answers)
  expect(storage.execution.listSetupJobs(setup.id)).toEqual([])
})

it("rejects saving a questions receipt over an existing bank with different context", async () => {
  // Given
  const { storage, setup, grant, pipeline, worker, fixture } = await given()
  const analysis = pipeline.prepare(setup.id, grant.id)
  queueQuestions(storage, setup.id, grant.id, analysis)
  await worker(false).runNext()
  const job = storage.execution.listSetupJobs(setup.id)[0]
  if (!job) throw new TypeError("Synthetic question job missing")
  storage.interviews.create({
    id: "retained-bank",
    studyId: setup.studyId,
    analysisRevisionId: analysis.id,
    contextRevisionId: "older-context",
    groups: [{ id: "focus", label: { en: "Focus", ja: "焦点" } }],
    shortlist: [fixture.question.id],
    steps: [{ groupId: "focus", purpose: "preference", question: fixture.question }],
  })
  // When / Then
  expect(() => saveQuestions(storage, job)).toThrow(/incompatible/i)
})

it("startup blocks an incompatible bank before scheduling any replacement analysis", async () => {
  // Given
  const { storage, setup, fixture } = await given()
  storage.interviews.create({
    id: "retained-bank",
    studyId: setup.studyId,
    analysisRevisionId: "analysis-1",
    contextRevisionId: "older-context",
    groups: [{ id: "focus", label: { en: "Focus", ja: "焦点" } }],
    shortlist: [fixture.question.id],
    steps: [{ groupId: "focus", purpose: "preference", question: fixture.question }],
  })
  const changed = storage.sources.appendSetup({
    record: {
      ...setup,
      id: "changed-setup",
      analysis: {
        ...setup.analysis,
        settings: { ...setup.analysis.settings, maxOutputTokens: 999 },
      },
    },
    parentRevisionId: setup.id,
  })
  const grant = storage.sources.getGrant("grant-1")
  if (!grant) throw new TypeError("Synthetic grant missing")
  storage.sources.appendGrant({ ...grant, id: "changed-grant", setupRevisionId: changed.id })
  // When
  await runProductionWorker(AbortSignal.abort())
  // Then
  expect(storage.execution.listSetupJobs(changed.id)).toEqual([])
  expect(storage.interviews.latest(setup.studyId)?.id).toBe("retained-bank")
})

it("does not admit output whose deduplicated choice bounds are unusable", async () => {
  // Given
  const { storage, setup, grant, pipeline, worker } = await given()
  queueQuestions(storage, setup.id, grant.id, pipeline.prepare(setup.id, grant.id))
  await worker(false).runNext()
  const job = storage.execution.listSetupJobs(setup.id)[0]
  if (!job) throw new TypeError("Synthetic question job missing")
  const attempts = storage.execution.listAttempts(job.runId)
  const body = attempts[0] && storage.execution.getAttemptReceipt(attempts[0].id)
  if (!body) throw new TypeError("Synthetic receipt missing")
  const { ProviderReceipt } = await import("@reading-studio/providers")
  const { DiscoveryDraft } = await import("@reading-studio/generation/questions")
  const receipt = ProviderReceipt.parse(JSON.parse(new TextDecoder().decode(body)))
  if (receipt.kind !== "output") throw new TypeError("Synthetic output missing")
  const valid = DiscoveryDraft.parse(JSON.parse(receipt.text))
  const lens = valid.lenses[0]
  const option = lens?.options[0]
  if (!lens || !option) throw new TypeError("Synthetic lens missing")
  const invalid = {
    ...valid,
    lenses: [
      {
        ...lens,
        mode: "multi",
        maxSelections: 2,
        options: [
          { ...option, id: "one" },
          { ...option, id: "two" },
        ],
      },
    ],
  }
  // When / Then
  expect(questionsStage(storage, job).schema.safeParse(invalid).success).toBe(false)
})
