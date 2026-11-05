import { queueQuestions } from "@reading-studio/generation/queue-questions"
import { setupAnalysisProgress } from "@reading-studio/server/study-setup-send"
import { afterEach, expect, it, vi } from "vitest"
import { questionHandoffFixture } from "./question-handoff-fixture.ts"

const fixtures: Awaited<ReturnType<typeof questionHandoffFixture>>[] = []
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

it("reports questions queued while their completed output is awaiting verification", async () => {
  // Given
  const fixture = await questionHandoffFixture(true)
  fixtures.push(fixture)
  const { storage, setup, grant, pipeline } = fixture
  queueQuestions(storage, setup.id, grant.id, pipeline.prepare(setup.id, grant.id))
  const question = storage.execution
    .listSetupJobs(setup.id)
    .find((job) => job.stage === "questions")
  if (!question) throw new TypeError("Missing synthetic question job")
  const run = storage.execution.getRun(question.runId)
  if (!run) throw new TypeError("Missing synthetic run")
  const claim = storage.execution.claimNextJob({
    token: "synthetic-claim",
    now: "2026-09-21T00:00:00.000Z",
    expiresAt: "2026-09-21T00:01:00.000Z",
  })
  if (claim?.state !== "running") throw new TypeError("Missing synthetic claim")
  storage.execution.completeJob({
    jobId: claim.id,
    token: claim.lease.token,
    fence: claim.lease.fence,
    now: "2026-09-21T00:00:01.000Z",
    resultHash: "a".repeat(64),
  })
  storage.execution.appendRun({ ...run, id: "check-synthetic" })
  storage.execution.appendJob({
    ...question,
    id: "check-synthetic",
    runId: "check-synthetic",
    stage: "analysis",
    state: "queued",
  })
  // When / Then
  expect(setupAnalysisProgress(storage, setup, grant.id)).toBe("questions-queued")
})
