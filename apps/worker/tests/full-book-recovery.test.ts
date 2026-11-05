import { randomUUID } from "node:crypto"
import { captureLibrary, openStorage } from "@reading-studio/storage"
import { FixtureDatabase } from "@reading-studio/storage/test-support"
import { afterEach, expect, it, vi } from "vitest"
import { z } from "zod"
import { directOutput } from "./full-book-direct-output.ts"
import { executionClock as clock, syntheticReplyMetadata } from "./full-book-execution-fixture.ts"
import { recoveryFixture } from "./full-book-recovery-fixture.ts"

afterEach(() => vi.unstubAllEnvs())
it("adds one pending hold without rewriting consent or either prior unknown fact", () => {
  // Given two exhausted counted unknowns and the exact finite reservation.
  const f = recoveryFixture(),
    before = f.storage.fullBookExecution.attempts(f.budget.id)
  try {
    // When the owner amendment is admitted, then original consent remains unchanged and one hold is added.
    f.storage.fullBookRecovery.approve(f.amendment)
    expect(f.storage.fullBookConsent.read(f.budget.id)).toEqual(f.budget)
    expect(f.storage.fullBookExecution.attempts(f.budget.id)).toEqual(before)
    expect(
      f.storage.fullBookConsent.commitments(
        f.budget.ownerId,
        f.budget.session.input.normalization.editionHash,
      ),
    ).toEqual({ spent: 2, held: f.budget.session.plan.maxAttempts - 1 })
    expect(f.storage.fullBookRecovery.inspect(f.budget.id)).toMatchObject({
      originalCeiling: f.budget.sourceCeiling,
      effectiveCeiling: f.budget.sourceCeiling + 1,
      state: "pending",
      stopAfterResult: true,
    })
  } finally {
    f.cleanup()
  }
})
it("claims once, charges only ordinal three, accepts through the normal runner and blocks all continuation", async () => {
  // Given an admitted one-shot amendment, not a generic retry-limit override.
  const f = recoveryFixture()
  try {
    f.storage.fullBookRecovery.approve(f.amendment)
    const prior = f.storage.fullBookExecution.attempts(f.budget.id)
    // When the normal runner completes this synthetic first-map attempt, then no later node is dispatchable.
    expect(
      await f.storage.fullBookManaged.run(f.grant.id, {
        signal: new AbortController().signal,
        now: () => clock.now,
      }),
    ).toMatchObject({ kind: "accepted" })
    expect(f.storage.fullBookExecution.attempts(f.budget.id).map((a) => a.reservation)).toEqual([
      1, 2, 3,
    ])
    expect(f.storage.fullBookExecution.attempts(f.budget.id).slice(0, 2)).toEqual(prior)
    expect(f.storage.fullBookExecution.receipts(f.budget.id)).toHaveLength(1)
    expect(
      f.storage.fullBookConsent.commitments(
        f.budget.ownerId,
        f.budget.session.input.normalization.editionHash,
      ),
    ).toEqual({ spent: 3, held: f.budget.session.plan.maxAttempts - 2 })
    expect(
      f.storage.fullBookExecution.claim({
        consentId: f.budget.id,
        token: randomUUID(),
        now: clock.now,
        expiresAt: clock.expiresAt,
      }),
    ).toBeNull()
    await expect(
      f.storage.fullBookManaged.run(f.grant.id, {
        signal: new AbortController().signal,
        now: () => clock.now,
      }),
    ).rejects.toThrow()
    expect(() => captureLibrary(f.options)).toThrow()
  } finally {
    f.cleanup()
  }
})
it("concurrent claimers and replayed permits cannot charge two recovery attempts", () => {
  // Given an admitted one-shot and another storage instance sharing the disposable ledger.
  const f = recoveryFixture(),
    other = openStorage(f.options)
  try {
    f.storage.fullBookRecovery.approve(f.amendment)
    const input = {
      consentId: f.budget.id,
      token: randomUUID(),
      now: clock.now,
      expiresAt: clock.expiresAt,
    }
    // When two owners contend, then fencing and atomic consumption admit only one charge.
    const lease = f.storage.fullBookExecution.claim(input)
    expect(lease).not.toBeNull()
    expect(other.fullBookExecution.claim({ ...input, token: randomUUID() })).toBeNull()
    if (!lease) throw new TypeError("Missing recovery lease")
    const prepared = f.storage.fullBookExecution.reserve({
      lease,
      now: clock.now,
      threadId: "unstarted",
      rpcId: 1,
    })
    expect(prepared.attempt.reservation).toBe(3)
    expect(() =>
      other.fullBookExecution.reserve({ lease, now: clock.now, threadId: "unstarted", rpcId: 2 }),
    ).toThrow()
    expect(() => other.fullBookRecovery.approve(f.amendment)).toThrow()
    f.storage.fullBookExecution.interrupt({ lease, attemptId: prepared.attempt.id })
    expect(f.storage.fullBookExecution.attempts(f.budget.id)[2]).toMatchObject({
      state: "outcome_unknown",
      resolution: "awaiting-owner",
    })
    expect(() =>
      f.storage.fullBookExecution.resolve({ attemptId: prepared.attempt.id, decision: "retry" }),
    ).toThrow()
    expect(f.storage.fullBookExecution.attempts(f.budget.id)).toHaveLength(3)
    const db = new FixtureDatabase(f.options.databasePath)
    try {
      expect(() => db.prepare("DELETE FROM full_book_recoveries").run()).toThrow()
    } finally {
      db.close()
    }
  } finally {
    other.close()
    f.cleanup()
  }
})
it.each([
  "jobId",
  "runId",
  "nativeBinding",
  "budgetBinding",
  "scopeBinding",
  "loggingBinding",
  "effectiveCeiling",
  "priorAttemptIds",
])("refuses changed %s without adding a hold", (key) => {
  // Given untrusted or foreign recovery metadata.
  const f = recoveryFixture()
  try {
    const changed = {
      ...f.amendment,
      [key]:
        key === "effectiveCeiling"
          ? f.amendment.effectiveCeiling + 1
          : key === "priorAttemptIds"
            ? [randomUUID(), f.amendment.priorAttemptIds[1]]
            : key === "runId"
              ? `fb-${"a".repeat(64)}`
              : "a".repeat(64),
    }
    // When/Then malformed or mismatched permission cannot alter the source budget.
    expect(() => f.storage.fullBookRecovery.approve(changed)).toThrow()
    expect(
      f.storage.fullBookConsent.commitments(
        f.budget.ownerId,
        f.budget.session.input.normalization.editionHash,
      ),
    ).toEqual({ spent: 2, held: f.budget.session.plan.maxAttempts - 2 })
  } finally {
    f.cleanup()
  }
})
it("does not permit a third attempt without the immutable amendment", async () => {
  // Given the original two-slot job with no additional owner permission.
  const f = recoveryFixture()
  try {
    // When/Then the ordinary runner cannot dispatch, irrespective of a caller's recovery flag.
    expect(
      await f.storage.fullBookManaged.run(f.grant.id, {
        signal: new AbortController().signal,
        now: () => clock.now,
      }),
    ).toMatchObject({ kind: "idle" })
    expect(f.storage.fullBookExecution.attempts(f.budget.id)).toHaveLength(2)
  } finally {
    f.cleanup()
  }
})
it("preserves the third charge as unknown after a crash before write, without spending a fourth", () => {
  // Given a charged recovery reservation with no provider write yet.
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
    f.storage.fullBookExecution.reserve({ lease, now: clock.now, threadId: "unstarted", rpcId: 1 })
    // When lease recovery runs, then every unknown remains counted and no new claim is issued.
    expect(f.storage.fullBookExecution.recover({ consentId: f.budget.id, now: clock.later })).toBe(
      1,
    )
    expect(f.storage.fullBookExecution.attempts(f.budget.id)[2]).toMatchObject({
      state: "outcome_unknown",
      resolution: "awaiting-owner",
    })
    expect(
      f.storage.fullBookConsent.preview(
        f.budget.ownerId,
        f.budget.session.input.normalization.editionHash,
      ),
    ).toMatchObject({
      spent: 3,
      held: f.budget.session.plan.maxAttempts - 2,
      unknown: 3,
      awaitingOwner: 2,
    })
    expect(
      f.storage.fullBookExecution.claim({
        consentId: f.budget.id,
        token: randomUUID(),
        now: clock.later,
        expiresAt: clock.laterExpiry,
      }),
    ).toBeNull()
  } finally {
    f.cleanup()
  }
})
it("recovers an uncharged lease without duplicating the pending permission or losing its hold", () => {
  // Given a lease crash before reservation has consumed the one-shot permission.
  const f = recoveryFixture()
  try {
    f.storage.fullBookRecovery.approve(f.amendment)
    const old = f.storage.fullBookExecution.claim({
      consentId: f.budget.id,
      token: randomUUID(),
      now: clock.now,
      expiresAt: clock.expiresAt,
    })
    if (!old) throw new TypeError("Missing initial lease")
    f.storage.fullBookExecution.recover({ consentId: f.budget.id, now: clock.later })
    // When a new fenced lease is claimed, then the stale lease cannot consume a charge.
    const next = f.storage.fullBookExecution.claim({
      consentId: f.budget.id,
      token: randomUUID(),
      now: clock.later,
      expiresAt: clock.laterExpiry,
    })
    expect(next).not.toBeNull()
    expect(() =>
      f.storage.fullBookExecution.reserve({
        lease: old,
        now: clock.later,
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
it("keeps charges readable after a later explicit owner cancellation and refuses incomplete export", async () => {
  // Given a consumed recovery and an independently requested stop in a disposable fixture only.
  const f = recoveryFixture()
  try {
    f.storage.fullBookRecovery.approve(f.amendment)
    await f.storage.fullBookManaged.run(f.grant.id, {
      signal: new AbortController().signal,
      now: () => clock.now,
    })
    // When the existing owner-cancel operation runs, then no charge is lost or silently exported without its amendment.
    f.storage.fullBookExecution.cancel(
      f.budget.id,
      "Separate explicit synthetic owner stop after recovery",
    )
    expect(
      f.storage.fullBookConsent.commitments(
        f.budget.ownerId,
        f.budget.session.input.normalization.editionHash,
      ),
    ).toEqual({ spent: 3, held: 0 })
    expect(f.storage.fullBookExecution.attempts(f.budget.id)).toHaveLength(3)
    expect(() => captureLibrary(f.options)).toThrow(
      "owner-recovery audit export is not implemented",
    )
  } finally {
    f.cleanup()
  }
})
it("retains a received recovery reply after lease loss without resending or exporting incomplete audit", () => {
  // Given a durable third response but no acceptance before the lease expires.
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
    const prepared = f.storage.fullBookExecution.reserve({
      lease,
      now: clock.now,
      threadId: "synthetic-thread",
      rpcId: 1,
    })
    f.storage.fullBookExecution.beforeWrite({
      lease,
      attemptId: prepared.attempt.id,
      now: clock.now,
    })
    f.storage.fullBookExecution.receive({
      attemptId: prepared.attempt.id,
      dispatchKey: prepared.wire.dispatchKey,
      serialized: JSON.stringify(directOutput(f.budget.session, [])),
      usage: { kind: "known", inputTokens: 1, outputTokens: 1 },
      receivedAt: clock.now,
      metadata: syntheticReplyMetadata(prepared.wire),
    })
    // When recovery observes that receipt, then the stop barrier preserves it without a fourth charge.
    f.storage.fullBookExecution.recover({ consentId: f.budget.id, now: clock.later })
    expect(f.storage.fullBookExecution.attempts(f.budget.id)[2]).toMatchObject({
      state: "response-received",
      reservation: 3,
    })
    expect(
      f.storage.fullBookExecution.claim({
        consentId: f.budget.id,
        token: randomUUID(),
        now: clock.later,
        expiresAt: clock.laterExpiry,
      }),
    ).toBeNull()
    expect(f.storage.fullBookExecution.receipts(f.budget.id)).toHaveLength(0)
    expect(() => captureLibrary(f.options)).toThrow(
      "owner-recovery audit export is not implemented",
    )
    const db = new FixtureDatabase(f.options.databasePath)
    try {
      expect(
        z
          .object({ n: z.number().positive() })
          .safeParse(
            db
              .prepare("SELECT length(response_body) AS n FROM external_attempts WHERE id=?")
              .get(prepared.attempt.id),
          ).success,
      ).toBe(true)
    } finally {
      db.close()
    }
  } finally {
    f.cleanup()
  }
})
