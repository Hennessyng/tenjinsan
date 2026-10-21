import { queueQuestions } from "@reading-studio/generation/queue-questions"
import { afterEach, expect, it, vi } from "vitest"
import { z } from "zod"
import { runProductionWorker } from "../src/production-runtime.ts"
import { WorkerRuntime } from "../src/runtime.ts"
import { questionHandoffFixture } from "./question-handoff-fixture.ts"

const fixtures: Awaited<ReturnType<typeof questionHandoffFixture>>[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  for (const fixture of fixtures.splice(0)) await fixture.close()
})

it("does not automatically schedule a consented setup with a persisted provider refusal", async () => {
  // Given
  const fixture = await questionHandoffFixture()
  fixtures.push(fixture)
  fixture.storage.setupScheduling.record({
    grantId: fixture.grant.id,
    failure: "unsupported-model",
  })
  // When
  await runProductionWorker(AbortSignal.abort())
  // Then
  expect(fixture.storage.execution.listSetupJobs(fixture.setup.id)).toEqual([])
  expect(fixture.storage.counts().attempts).toBe(0)
})

it.each(["superseded", "incompatible-bank"])(
  "continues other queued work when the completed analysis handoff becomes %s",
  async (change) => {
    // Given
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Network forbidden")
      }),
    )
    const fixture = await questionHandoffFixture()
    fixtures.push(fixture)
    const { storage, setup, grant, pipeline } = fixture
    pipeline.prepare(setup.id, grant.id)
    const runNext = WorkerRuntime.prototype.runNext
    let changed = false
    vi.spyOn(WorkerRuntime.prototype, "runNext").mockImplementation(async function (
      this: WorkerRuntime,
    ) {
      const result = await runNext.call(this)
      if (
        !changed &&
        result.kind === "provider" &&
        result.job.stage === "analysis" &&
        result.job.state === "completed"
      ) {
        changed = true
        const analysis = pipeline.prepare(setup.id, grant.id)
        storage.sources.createStudy({
          id: "other-study",
          ownerId: grant.ownerId,
          editionId: setup.editionId,
        })
        const other = storage.sources.appendSetup({
          record: { ...setup, id: "other-setup", studyId: "other-study" },
          parentRevisionId: null,
        })
        const otherGrant = storage.sources.appendGrant({
          ...grant,
          id: "other-grant",
          setupRevisionId: other.id,
        })
        queueQuestions(storage, other.id, otherGrant.id, analysis)
        if (change === "superseded")
          storage.sources.appendSetup({
            record: { ...setup, id: "superseding-setup" },
            parentRevisionId: setup.id,
          })
        else
          storage.interviews.create({
            id: "retained-bank",
            studyId: setup.studyId,
            analysisRevisionId: analysis.id,
            contextRevisionId: "older-context",
            groups: [{ id: "focus", label: { en: "Focus", ja: "焦点" } }],
            shortlist: [fixture.fixture.question.id],
            steps: [
              {
                groupId: "focus",
                purpose: "preference",
                question: { ...fixture.fixture.question, analysisRevisionId: analysis.id },
              },
            ],
          })
      }
      return result
    })
    const logs = vi.spyOn(console, "info").mockImplementation(() => {})
    const stop = new AbortController()
    // When
    const outcome = runProductionWorker(stop.signal).then(
      () => null,
      (error: unknown) => error,
    )
    const completed = vi
      .waitFor(
        () => {
          if (stop.signal.aborted) return
          expect(storage.interviews.latest("other-study")?.steps).toHaveLength(1)
        },
        { timeout: 8000 },
      )
      .then(
        () => null,
        (error: unknown) => error,
      )
    const first = await Promise.race([outcome, completed])
    stop.abort()
    const error = await outcome
    await completed
    // Then
    expect(first).toBeNull()
    expect(error).toBeNull()
    expect(changed).toBe(true)
    expect(storage.interviews.latest("other-study")?.steps).toHaveLength(1)
    expect(
      storage.execution.listSetupJobs(setup.id).filter((job) => job.stage === "questions"),
    ).toEqual([])
    expect(
      logs.mock.calls.some(
        ([message]) =>
          typeof message === "string" &&
          z
            .object({
              event: z.literal("question-handoff-blocked"),
              code: z.literal(change === "superseded" ? "unauthorized" : "bank-incompatible"),
            })
            .safeParse(JSON.parse(message)).success,
      ),
    ).toBe(true)
    if (change === "incompatible-bank")
      expect(storage.interviews.latest(setup.studyId)?.id).toBe("retained-bank")
  },
  12000,
)
