import { contentDigest } from "@reading-studio/contracts"
import { afterEach, expect, it, vi } from "vitest"
import { readinessFixture } from "./testing/interview-readiness-fixture.ts"

const fixtures: Awaited<ReturnType<typeof readinessFixture>>[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const fixture of fixtures.splice(0)) await fixture.close()
})
async function approved() {
  const fixture = await readinessFixture()
  fixtures.push(fixture)
  const setupId = await fixture.draft()
  expect((await fixture.decide(setupId)).status).toBe(200)
  const setup = fixture.storage.sources.getSetup(setupId)
  if (!setup) throw new TypeError("Missing setup")
  return { ...fixture, setup }
}
const running = {
  state: "running",
  lease: {
    token: "fixture",
    fence: 1,
    heartbeatAt: "2026-01-01T00:00:00Z",
    expiresAt: "2026-01-01T00:01:00Z",
  },
} as const
const failed = { state: "failed", error: { code: "input-limit", retryable: false } } as const

it.each(["queued", "running"] as const)(
  "shows current questions %s after successful analysis instead of an old failed analysis job",
  async (state) => {
    // Given
    const fixture = await approved()
    fixture.seedJob(fixture.setup.id, "old-analysis", { stage: "analysis", ...failed })
    fixture.completeAnalysis(fixture.setup)
    fixture.seedJob(fixture.setup.id, "current-questions", {
      stage: "questions",
      ...(state === "queued" ? { state } : running),
    })
    // When
    const response = await fixture.status()
    // Then
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      kind: "progress",
      stage: "questions",
      state,
      reason: null,
    })
  },
)

it.each(["queued", "running"] as const)(
  "keeps an unresolved failed analysis window ahead of a different %s window",
  async (state) => {
    // Given
    const fixture = await approved()
    fixture.seedJob(fixture.setup.id, "window-0", { stage: "analysis", ...failed })
    fixture.seedJob(fixture.setup.id, "window-1", {
      stage: "analysis",
      ...(state === "queued" ? { state } : running),
    })
    // When
    const response = await fixture.status()
    // Then
    expect(await response.json()).toMatchObject({
      stage: "analysis",
      state: "failed",
      reason: "input-limit",
    })
  },
)

it("uses stable identity order for equal-priority windows, independently of repository row order", async () => {
  // Given
  const fixture = await approved()
  fixture.seedJob(fixture.setup.id, "window-a", {
    stage: "analysis",
    state: "paused",
    reason: "outcome_unknown",
  })
  fixture.seedJob(fixture.setup.id, "window-z", {
    stage: "analysis",
    state: "paused",
    reason: "budget-exhausted",
  })
  const list = fixture.storage.execution.listSetupJobs.bind(fixture.storage.execution)
  const ownerList = fixture.storage.execution.listOwnerJobs.bind(fixture.storage.execution)
  vi.spyOn(fixture.storage.execution, "listSetupJobs").mockImplementation((id) =>
    [...list(id)].reverse(),
  )
  vi.spyOn(fixture.storage.execution, "listOwnerJobs").mockImplementation((id) =>
    [...ownerList(id)].reverse(),
  )
  // When
  const reversed = await fixture.status()
  vi.restoreAllMocks()
  const ordinary = await fixture.status()
  // Then
  expect(await reversed.json()).toEqual(await ordinary.json())
})

it.each(["analysis", "questions"] as const)(
  "does not claim saved questions or pending work for completed-only %s jobs",
  async (stage) => {
    // Given
    const fixture = await approved()
    fixture.seedJob(fixture.setup.id, "done", {
      stage,
      state: "completed",
      resultHash: contentDigest("completed fixture"),
    })
    // When
    const response = await fixture.status()
    // Then
    expect(await response.json()).toMatchObject({
      kind: "progress",
      stage,
      state: "not-scheduled",
      reason: null,
    })
  },
)

it("names the unscheduled question stage when successful analysis is saved without a question job", async () => {
  // Given
  const fixture = await approved()
  fixture.completeAnalysis(fixture.setup)
  // When
  const response = await fixture.status()
  // Then
  expect(await response.json()).toMatchObject({
    kind: "progress",
    stage: "questions",
    state: "not-scheduled",
  })
})

it("shows a real explicitly retried job's current queued state rather than its old failure", async () => {
  // Given
  const fixture = await approved()
  fixture.seedJob(fixture.setup.id, "retry-window", { stage: "analysis", state: "queued" })
  const execution = fixture.storage.execution
  const claimed = execution.claimNextJob({
    token: "lease",
    now: "2026-01-01T00:00:00Z",
    expiresAt: "2026-01-01T00:01:00Z",
  })
  if (claimed?.state !== "running") throw new TypeError("Missing running job")
  const lease = {
    jobId: claimed.id,
    token: claimed.lease.token,
    fence: claimed.lease.fence,
    now: "2026-01-01T00:00:01Z",
  }
  execution.reserveAttempt({ ...lease, attemptId: "attempt-retry", preparedAt: lease.now })
  execution.markAttemptDispatching({
    ...lease,
    attemptId: "attempt-retry",
    dispatchedAt: lease.now,
  })
  execution.recordAttemptReceipt({
    ...lease,
    attemptId: "attempt-retry",
    receivedAt: lease.now,
    responseBody: new TextEncoder().encode("{}"),
    usage: { kind: "known", inputTokens: 0, outputTokens: 0 },
  })
  execution.failProviderJob({ lease, code: "provider-failure", retryable: true })
  execution.retryProviderJob(claimed.id)
  // When
  const response = await fixture.status()
  // Then
  expect(await response.json()).toMatchObject({ stage: "analysis", state: "queued", reason: null })
})
