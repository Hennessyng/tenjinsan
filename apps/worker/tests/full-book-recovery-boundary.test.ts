import { randomUUID } from "node:crypto"
import { FixtureDatabase } from "@reading-studio/storage/test-support"
import { afterEach, expect, it, vi } from "vitest"
import { executionClock as clock } from "./full-book-execution-fixture.ts"
import { recoveryFixture } from "./full-book-recovery-fixture.ts"

afterEach(() => vi.unstubAllEnvs())
it("does not consume a pending permission after its exact native grant is revoked", () => {
  // Given an admitted permission and a lease, followed by an explicit synthetic grant revocation.
  const f = recoveryFixture()
  try {
    f.storage.fullBookRecovery.approve(f.amendment)
    const lease = f.storage.fullBookExecution.claim({
      consentId: f.budget.id,
      token: randomUUID(),
      now: clock.now,
      expiresAt: clock.expiresAt,
    })
    if (!lease) throw new TypeError("Missing recovery lease")
    f.storage.fullBookManagedConsents.revoke(
      f.grant.id,
      "Separate synthetic owner revocation before charge",
    )
    // When/Then reservation cannot consume the one-shot hold under stale native authority.
    expect(() =>
      f.storage.fullBookExecution.reserve({
        lease,
        now: clock.now,
        threadId: "unstarted",
        rpcId: 1,
      }),
    ).toThrow()
    expect(f.storage.fullBookExecution.attempts(f.budget.id)).toHaveLength(2)
    expect(f.storage.fullBookRecovery.inspect(f.budget.id)).toMatchObject({ state: "pending" })
  } finally {
    f.cleanup()
  }
})
it("enforces the stop and monotonic caps independently in SQL, not just the runner", async () => {
  // Given a consumed and accepted recovery in a disposable library, with all future holds still reserved.
  const f = recoveryFixture()
  try {
    f.storage.fullBookRecovery.approve(f.amendment)
    await f.storage.fullBookManaged.run(f.grant.id, {
      signal: new AbortController().signal,
      now: () => clock.now,
    })
    const before = f.storage.fullBookExecution.attempts(f.budget.id)
    const db = new FixtureDatabase(f.options.databasePath)
    try {
      // When invalid counters, future-node claims or old-outcome rewrites are attempted, then each guard rejects atomically.
      expect(() =>
        db
          .prepare(
            "UPDATE generation_runs SET reserved_calls=4,record_json=json_set(record_json,'$.reservedCalls',4) WHERE id=?",
          )
          .run(f.amendment.runId),
      ).toThrow()
      expect(() =>
        db
          .prepare(
            "UPDATE generation_runs SET reserved_calls=2,record_json=json_set(record_json,'$.reservedCalls',2) WHERE id=?",
          )
          .run(f.amendment.runId),
      ).toThrow()
      expect(() =>
        db
          .prepare(
            "UPDATE full_book_jobs SET state='running',fence=fence+1,token=?,expires_at=? WHERE consent_id=? AND node_index=1",
          )
          .run(randomUUID(), clock.expiresAt, f.budget.id),
      ).toThrow()
      expect(() =>
        db.prepare("UPDATE full_book_recoveries SET effective_ceiling=effective_ceiling+1").run(),
      ).toThrow()
      expect(() =>
        db
          .prepare("UPDATE external_attempts SET state='response-received' WHERE id=?")
          .run(f.amendment.priorAttemptIds[1]),
      ).toThrow()
    } finally {
      db.close()
    }
    expect(f.storage.fullBookExecution.attempts(f.budget.id)).toEqual(before)
    expect(
      f.storage.fullBookConsent.commitments(
        f.budget.ownerId,
        f.budget.session.input.normalization.editionHash,
      ),
    ).toEqual({ spent: 3, held: f.budget.session.plan.maxAttempts - 2 })
  } finally {
    f.cleanup()
  }
})
