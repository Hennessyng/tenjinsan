import { defaultSettings } from "@reading-studio/providers"
import { afterEach, expect, it, vi } from "vitest"
import { interviewFixture } from "./testing/interview-fixture.ts"
import { readinessFixture } from "./testing/interview-readiness-fixture.ts"
import { ownerJobsFixture } from "./testing/owner-jobs-fixture.ts"

const fixtures: { readonly close: () => Promise<void> }[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const fixture of fixtures.splice(0)) await fixture.close()
})

it.each([false, true])(
  "ignores another study's jobs and does not read their run even when unavailable=%s",
  async (unavailable) => {
    // Given
    const fixture = await readinessFixture()
    fixtures.push(fixture)
    const setupId = await fixture.draft()
    expect((await fixture.decide(setupId)).status).toBe(200)
    const setup = fixture.storage.sources.getSetup(setupId)
    if (!setup) throw new TypeError("Missing setup")
    fixture.seedJob(setupId, "current", { stage: "analysis", state: "queued" })
    fixture.storage.sources.createStudy({ ...fixture.study, id: "study-other" })
    fixture.storage.sources.appendSetup({
      parentRevisionId: null,
      record: { ...setup, id: "setup-other", studyId: "study-other" },
    })
    const grant = fixture.storage.sources.getGrant(`grant-${setupId}`)
    if (!grant) throw new TypeError("Missing grant")
    fixture.storage.sources.appendGrant({
      ...grant,
      id: "grant-setup-other",
      setupRevisionId: "setup-other",
    })
    fixture.seedJob("setup-other", "unrelated", {
      stage: "questions",
      state: "failed",
      error: { code: "input-limit", retryable: false },
    })
    const getRun = fixture.storage.execution.getRun.bind(fixture.storage.execution)
    const reads = vi
      .spyOn(fixture.storage.execution, "getRun")
      .mockImplementation((id) => (unavailable && id === "run-unrelated" ? null : getRun(id)))
    const before = fixture.storage.counts()
    // When
    const response = await fixture.status()
    // Then
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ stage: "analysis", state: "queued" })
    expect(reads.mock.calls.some(([id]) => id === "run-unrelated")).toBe(false)
    expect(fixture.storage.counts()).toEqual(before)
  },
)

it("ignores failed jobs from a superseded setup of the same study", async () => {
  // Given
  const fixture = await readinessFixture()
  fixtures.push(fixture)
  const old = await fixture.draft()
  expect((await fixture.decide(old)).status).toBe(200)
  fixture.seedJob(old, "old-job", {
    stage: "analysis",
    state: "failed",
    error: { code: "input-limit", retryable: false },
  })
  const current = await fixture.draft()
  expect((await fixture.decide(current)).status).toBe(200)
  fixture.seedJob(current, "current-job", { stage: "analysis", state: "queued" })
  // When
  const response = await fixture.status()
  // Then
  expect(await response.json()).toMatchObject({
    stage: "analysis",
    state: "queued",
    actionHref: `/jobs?setup=${current}`,
  })
})

it.each(["cancel", "revise"] as const)(
  "links a %s/revoked draft to fresh setup rather than its consumed review",
  async (decision) => {
    // Given
    const fixture = await readinessFixture()
    fixtures.push(fixture)
    const setupId = await fixture.draft()
    expect((await fixture.decide(setupId, decision)).status).toBe(200)
    // When
    const response = await fixture.status()
    // Then
    expect(await response.json()).toEqual({
      kind: "review-required",
      actionHref: `/sources/${fixture.revision}/setup`,
    })
  },
)

it("keeps the saved interview API and answers ahead of a newer setup", async () => {
  // Given
  const fixture = await interviewFixture()
  fixtures.push(fixture)
  const { storage, definition } = fixture
  storage.interviews.save({
    studyId: definition.studyId,
    interviewId: definition.id,
    answer: {
      kind: "choice",
      questionId: "angle",
      questionRevisionId: "angle-v1",
      optionIds: ["listen"],
    },
  })
  const answers = storage.interviews.answers(definition.id)
  const analysis = storage.workflow.getAnalysis(definition.analysisRevisionId)
  if (!analysis) throw new TypeError("Missing saved analysis")
  storage.sources.appendSetup({
    parentRevisionId: null,
    record: {
      id: "setup-newer",
      studyId: definition.studyId,
      editionId: analysis.editionId,
      analysis: analysis.cacheInput,
      generation: {
        promptVersion: "generation-1",
        schemaVersion: "generation-1",
        settings: defaultSettings,
      },
    },
  })
  // When
  const status = await fetch(`${fixture.origin}/api/interview-readiness/${definition.studyId}`)
  const interview = await fetch(`${fixture.origin}/api/interviews/${definition.studyId}`)
  // Then
  expect(await status.json()).toEqual({
    kind: "ready",
    actionHref: `/interviews/${definition.studyId}`,
  })
  expect(await interview.json()).toEqual({ definition, answers })
})

it("directs historical-inert work to a fresh setup without starting or changing it", async () => {
  // Given
  const { fixture } = await ownerJobsFixture("openai")
  fixtures.push(fixture)
  const before = fixture.storage.execution.getJob("job-jobs")
  // When
  const response = await fetch(`${fixture.origin}/api/interview-readiness/study-fixture`)
  // Then
  expect(await response.json()).toEqual({
    kind: "review-required",
    actionHref: "/sources/revision-fixture/setup",
  })
  expect(fixture.storage.execution.getJob("job-jobs")).toEqual(before)
})
