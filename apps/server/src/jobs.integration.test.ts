import { DatabaseSync } from "node:sqlite"
import { afterEach, beforeEach, expect, test } from "vitest"
import { ownerJobsFixture } from "./testing/owner-jobs-fixture.ts"

let fixture: Awaited<ReturnType<typeof ownerJobsFixture>>["fixture"]
let cookie: string

beforeEach(async () => {
  const prepared = await ownerJobsFixture()
  fixture = prepared.fixture
  cookie = prepared.cookie
})
afterEach(async () => fixture.close())

test("lists only sanitized owned jobs when signed in", async () => {
  // Given: a queued job on a real owner study.
  // When: the owner reads jobs.
  const response = await fetch(`${fixture.origin}/api/study-jobs`, { headers: { cookie } })
  // Then: a safe, current projection is available, not the raw job record.
  expect(response.status).toBe(200)
  const body = await response.json()
  expect(body.jobs[0]).toMatchObject({
    id: "job-jobs",
    studyId: "study-fixture",
    state: "queued",
    setupRevisionId: "setup-jobs",
  })
  expect(JSON.stringify(body)).not.toMatch(/grant|lease|promptVersion|responseBody|apiKey|opening/)
})

test("shows direct-OpenAI history but refuses dispatch and retry", async () => {
  const historical = await ownerJobsFixture("openai")
  try {
    const response = await fetch(`${historical.fixture.origin}/api/study-jobs`, {
      headers: { cookie: historical.cookie },
    })
    expect((await response.json()).jobs[0]).toMatchObject({
      provider: "openai",
      state: "historical-inert",
      canRetry: false,
    })
    const retry = await fetch(`${historical.fixture.origin}/api/study-jobs/job-jobs/retry`, {
      method: "POST",
      headers: {
        cookie: historical.cookie,
        origin: historical.fixture.origin,
        "content-type": "application/json",
      },
      body: JSON.stringify({ expectedSetupRevisionId: "setup-jobs" }),
    })
    expect(retry.status).toBe(409)
    expect(
      historical.fixture.storage.execution.claimNextJob({
        token: "retired",
        now: "2026-01-01T00:00:00Z",
        expiresAt: "2026-01-01T00:01:00Z",
      }),
    ).toBeNull()
    expect(historical.fixture.storage.execution.listAttempts("run-jobs")).toHaveLength(0)
  } finally {
    await historical.fixture.close()
  }
})

test("cancels a queued job only with the current revision and same-origin owner session", async () => {
  // Given: the queued job above.
  // When: a revision-bound owner cancel is submitted.
  const response = await fetch(`${fixture.origin}/api/study-jobs/job-jobs/cancel`, {
    method: "POST",
    headers: { cookie, origin: fixture.origin, "content-type": "application/json" },
    body: JSON.stringify({ expectedSetupRevisionId: "setup-jobs" }),
  })
  // Then: cancellation is durable.
  expect(response.status).toBe(200)
  expect(fixture.storage.execution.getJob("job-jobs")?.state).toBe("cancelled")
})

function command(action: string, input: unknown, headers?: Record<string, string>) {
  return fetch(`${fixture.origin}/api/study-jobs/job-jobs/${action}`, {
    method: "POST",
    headers: { cookie, origin: fixture.origin, "content-type": "application/json", ...headers },
    body: JSON.stringify(input),
  })
}

test("rejects anonymous, cross-origin, foreign and stale job decisions", async () => {
  // Given: a valid queued job owned by the signed-in session.
  // When: unauthorized and stale callers try to act on it.
  const anonymous = await fetch(`${fixture.origin}/api/study-jobs`)
  const foreign = await fetch(`${fixture.origin}/api/study-jobs/foreign-job/cancel`, {
    method: "POST",
    headers: { cookie, origin: fixture.origin, "content-type": "application/json" },
    body: JSON.stringify({ expectedSetupRevisionId: "setup-jobs" }),
  })
  const crossOrigin = await command(
    "cancel",
    { expectedSetupRevisionId: "setup-jobs" },
    { origin: "https://attacker.example" },
  )
  const stale = await command("cancel", { expectedSetupRevisionId: "old-setup" })
  // Then: none mutates the job.
  expect([anonymous.status, foreign.status, crossOrigin.status, stale.status]).toEqual([
    401, 404, 403, 409,
  ])
  expect(fixture.storage.execution.getJob("job-jobs")?.state).toBe("queued")
})

test("pauses an accepted unknown outcome until an explicit confirmed owner decision", async () => {
  // Given: an accepted call with no provider receipt.
  const execution = fixture.storage.execution
  const claimed = execution.claimNextJob({
    token: "lease-jobs",
    now: "2026-01-01T00:00:00.000Z",
    expiresAt: "2026-01-01T00:01:00.000Z",
  })
  if (claimed?.state !== "running") throw new TypeError("Fixture job was not claimed")
  const lease = {
    jobId: claimed.id,
    token: claimed.lease.token,
    fence: claimed.lease.fence,
    now: "2026-01-01T00:00:01.000Z",
  }
  execution.reserveAttempt({ ...lease, attemptId: "attempt-jobs", preparedAt: lease.now })
  execution.markAttemptDispatching({ ...lease, attemptId: "attempt-jobs", dispatchedAt: lease.now })
  execution.pauseUnknownProviderJob(lease)
  // When: the owner reads and tries an ordinary retry, then explicitly resolves.
  const snapshot = await fetch(`${fixture.origin}/api/study-jobs`, { headers: { cookie } })
  const body = await snapshot.json()
  const ordinaryRetry = await command("retry", { expectedSetupRevisionId: "setup-jobs" })
  const unconfirmed = await command("resolve", {
    expectedSetupRevisionId: "setup-jobs",
    choice: "retry-approved",
    confirmation: "stop-approved",
    reason: "Try again with an unknown charge",
  })
  const approved = await command("resolve", {
    expectedSetupRevisionId: "setup-jobs",
    choice: "stop-approved",
    confirmation: "stop-approved",
    reason: "Accepted call may have charged me",
  })
  // Then: unknown usage remains unknown even after stopping.
  expect(body.jobs[0]).toMatchObject({
    state: "paused",
    reason: "outcome_unknown",
    attempts: 1,
    usage: { kind: "unknown" },
    unknownAttemptId: "attempt-jobs",
  })
  expect([ordinaryRetry.status, unconfirmed.status, approved.status]).toEqual([409, 400, 200])
  expect(execution.getAttempt("attempt-jobs")).toMatchObject({
    state: "outcome_unknown",
    resolution: "stop-approved",
    usage: { kind: "unknown" },
  })
  const audit = new DatabaseSync(fixture.databasePath, { readOnly: true })
  try {
    expect(
      audit
        .prepare("SELECT action, reason FROM owner_job_decisions WHERE job_id = ?")
        .get("job-jobs"),
    ).toMatchObject({ action: "stop-approved", reason: "Accepted call may have charged me" })
  } finally {
    audit.close()
  }
})

test("requires explicit paid-call acknowledgment before cancelling running work", async () => {
  // Given: a running job which might already be accepted by the provider.
  const claimed = fixture.storage.execution.claimNextJob({
    token: "lease-cancel",
    now: "2026-01-01T00:00:00.000Z",
    expiresAt: "2026-01-01T00:01:00.000Z",
  })
  if (claimed?.state !== "running") throw new TypeError("Fixture job not running")
  // When: the owner tries cancel without and then with explicit confirmation.
  const denied = await command("cancel", { expectedSetupRevisionId: "setup-jobs" })
  const approved = await command("cancel", {
    expectedSetupRevisionId: "setup-jobs",
    choice: "stop-approved",
    confirmation: "stop-approved",
    reason: "I understand accepted calls may charge",
  })
  // Then: only the confirmed request sets durable cancellation intent.
  expect([denied.status, approved.status]).toEqual([400, 200])
  expect(fixture.storage.execution.getJob("job-jobs")?.cancellationRequested).toBe(true)
})

test("sanitizes a failed receipt and bounds explicit retry to one decision per attempt", async () => {
  // Given: a receipt followed by a retryable failure with hostile diagnostic text.
  const execution = fixture.storage.execution
  const claim = execution.claimNextJob({
    token: "lease-failure",
    now: "2026-01-01T00:00:00.000Z",
    expiresAt: "2026-01-01T00:01:00.000Z",
  })
  if (claim?.state !== "running") throw new TypeError("Fixture job not running")
  const lease = {
    jobId: claim.id,
    token: claim.lease.token,
    fence: claim.lease.fence,
    now: "2026-01-01T00:00:01.000Z",
  }
  execution.reserveAttempt({ ...lease, attemptId: "attempt-failure", preparedAt: lease.now })
  execution.markAttemptDispatching({
    ...lease,
    attemptId: "attempt-failure",
    dispatchedAt: lease.now,
  })
  execution.recordAttemptReceipt({
    ...lease,
    attemptId: "attempt-failure",
    receivedAt: "2026-01-01T00:00:02.000Z",
    responseBody: new TextEncoder().encode("secret response text"),
    usage: { kind: "known", inputTokens: 19, outputTokens: 3 },
  })
  execution.failProviderJob({
    lease,
    code: "<script>secret provider message</script>",
    retryable: true,
  })
  // When: the owner inspects and explicitly retries.
  const read = await fetch(`${fixture.origin}/api/study-jobs`, { headers: { cookie } })
  const body = await read.json()
  const retry = await command("retry", { expectedSetupRevisionId: "setup-jobs" })
  const repeated = await command("retry", { expectedSetupRevisionId: "setup-jobs" })
  // Then: the failure is sanitized and the same receipt cannot be retried twice.
  expect(body.jobs[0]).toMatchObject({
    failureCode: "provider-failure",
    attempts: 1,
    usage: { kind: "known", inputTokens: 19, outputTokens: 3 },
    canRetry: true,
    callBudgetRemaining: 63,
  })
  expect(JSON.stringify(body)).not.toContain("secret")
  expect([retry.status, repeated.status]).toEqual([200, 409])
  expect(execution.getAttempt("attempt-failure")).toMatchObject({ retryApproved: true })
})

test("queues an unknown call only after the owner confirms a second paid attempt", async () => {
  // Given: a paused call with no receipt.
  const execution = fixture.storage.execution
  const claimed = execution.claimNextJob({
    token: "lease-retry-unknown",
    now: "2026-01-01T00:00:00.000Z",
    expiresAt: "2026-01-01T00:01:00.000Z",
  })
  if (claimed?.state !== "running") throw new TypeError("Fixture job not running")
  const lease = {
    jobId: claimed.id,
    token: claimed.lease.token,
    fence: claimed.lease.fence,
    now: "2026-01-01T00:00:01.000Z",
  }
  execution.reserveAttempt({ ...lease, attemptId: "attempt-retry-unknown", preparedAt: lease.now })
  execution.markAttemptDispatching({
    ...lease,
    attemptId: "attempt-retry-unknown",
    dispatchedAt: lease.now,
  })
  execution.pauseUnknownProviderJob(lease)
  // When: the owner explicitly confirms retry with an audited reason.
  const response = await command("resolve", {
    expectedSetupRevisionId: "setup-jobs",
    choice: "retry-approved",
    confirmation: "retry-approved",
    reason: "Accept possible second provider charge",
  })
  // Then: the old attempt remains unknown and a new job is queued, without immediate dispatch.
  expect(response.status).toBe(200)
  expect(execution.getJob("job-jobs")).toMatchObject({
    state: "queued",
    usage: { kind: "unknown" },
  })
  expect(execution.getAttempt("attempt-retry-unknown")).toMatchObject({
    state: "outcome_unknown",
    resolution: "retry-approved",
    usage: { kind: "unknown" },
  })
  expect(execution.listAttempts("run-jobs")).toHaveLength(1)
})
