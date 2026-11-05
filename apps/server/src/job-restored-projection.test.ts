import { afterEach, expect, it, vi } from "vitest"
import { projectOwnerJobs } from "./job-projection.ts"
import { ownerJobsFixture } from "./testing/owner-jobs-fixture.ts"

const fixtures: Awaited<ReturnType<typeof ownerJobsFixture>>[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const fixture of fixtures.splice(0)) await fixture.fixture.close()
})

it.each(["restored", "live"] as const)(
  "reflects %s shared-budget authority in the job projection",
  async (kind) => {
    // Given
    const prepared = await ownerJobsFixture()
    fixtures.push(prepared)
    const { storage } = prepared.fixture
    const claim = storage.execution.claimNextJob({
      token: "synthetic-claim",
      now: "2026-01-01T00:00:00.000Z",
      expiresAt: "2026-01-01T00:01:00.000Z",
    })
    if (claim?.state !== "running") throw new TypeError("Missing synthetic job")
    const lease = {
      jobId: claim.id,
      token: claim.lease.token,
      fence: claim.lease.fence,
      now: "2026-01-01T00:00:01.000Z",
    }
    storage.execution.reserveAttempt({
      ...lease,
      attemptId: "synthetic-attempt",
      preparedAt: lease.now,
    })
    storage.execution.markAttemptDispatching({
      ...lease,
      attemptId: "synthetic-attempt",
      dispatchedAt: lease.now,
    })
    storage.execution.recordAttemptReceipt({
      ...lease,
      attemptId: "synthetic-attempt",
      receivedAt: lease.now,
      responseBody: new TextEncoder().encode(
        JSON.stringify({
          kind: "error",
          code: "rate-limited",
          diagnostic: "rate-limited",
          usage: { kind: "known", inputTokens: 1, outputTokens: 1 },
        }),
      ),
      usage: { kind: "known", inputTokens: 1, outputTokens: 1 },
    })
    storage.execution.failProviderJob({ lease, code: "synthetic-failure", retryable: true })
    vi.spyOn(storage.liveStudyGuard, "sharedStatus").mockReturnValue({
      id: "synthetic-budget",
      used: 1,
      remaining: 19,
      limit: 20,
      kind,
      retired: false,
    })
    // When
    const projection = projectOwnerJobs(storage, claim.grant.ownerId).jobs[0]
    // Then
    expect(projection).toMatchObject({ retired: kind === "restored", canRetry: kind === "live" })
  },
)
