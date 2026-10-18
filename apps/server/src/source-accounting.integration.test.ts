import { expect, it } from "vitest"
import { ownerJobsFixture } from "./testing/owner-jobs-fixture.ts"

it("exposes receipt range accounting without source text or semantic completion claims", async () => {
  // Given
  const { fixture } = await ownerJobsFixture()
  try {
    const execution = fixture.storage.execution
    const job = execution.claimNextJob({
      token: "accounting",
      now: "2026-01-01T00:00:00Z",
      expiresAt: "2026-01-01T01:00:00Z",
    })
    if (job?.state !== "running") throw new TypeError("Missing claimed job")
    const lease = {
      jobId: job.id,
      token: job.lease.token,
      fence: job.lease.fence,
      now: "2026-01-01T00:00:01Z",
    }
    execution.reserveAttempt({ ...lease, attemptId: "coverage-attempt", preparedAt: lease.now })
    execution.markAttemptDispatching({
      ...lease,
      attemptId: "coverage-attempt",
      dispatchedAt: lease.now,
    })
    const coverage = {
      extraction: "partial",
      transmission: "window-only",
      processing: "not-established",
      requestHash: "a".repeat(64),
      ranges: [{ resourcePath: "chapter-one.xhtml", blockId: "opening", start: 0, end: 5 }],
      reviewedRanges: [
        { resourcePath: "chapter-one.xhtml", blockId: "opening", start: 0, end: 10 },
      ],
      omissions: [{ path: "chapter-two.xhtml", reason: "empty-text" }],
    }
    execution.recordAttemptReceipt({
      ...lease,
      attemptId: "coverage-attempt",
      receivedAt: lease.now,
      responseBody: Buffer.from(
        JSON.stringify({
          kind: "output",
          text: "private response",
          usage: { kind: "unknown" },
          inputCoverage: coverage,
        }),
      ),
      usage: { kind: "unknown" },
    })
    // When
    const response = await fetch(`${fixture.origin}/api/study-jobs`)
    const body = await response.json()
    // Then
    expect(body.jobs[0]).toMatchObject({ inputCoverage: [coverage] })
    expect(JSON.stringify(body)).not.toContain("private response")
  } finally {
    await fixture.close()
  }
})
