import { randomUUID } from "node:crypto"
import {
  contentDigest,
  FullBookManagedConsent,
  FullBookManagedPolicy,
  PINNED_CODEX_BUILD,
} from "@reading-studio/contracts"
import { openStorage } from "@reading-studio/storage"
import {
  FixtureDatabase,
  FullBookRecoveryAmendment,
  fullBookNativeReleased,
  fullBookNativeScope,
} from "@reading-studio/storage/test-support"
import { afterEach, expect, it, vi } from "vitest"
import { z } from "zod"
import { executionClock as clock } from "./full-book-execution-fixture.ts"
import { recoveryFixture } from "./full-book-recovery-fixture.ts"

afterEach(() => vi.unstubAllEnvs())

it("reads persisted native three-charge history after restart without permitting another dispatch", async () => {
  // Given a disposable synthetic ledger with a consumed recovery and three counted unknowns.
  const f = recoveryFixture()
  try {
    f.storage.fullBookRecovery.approve(f.amendment)
    const lease = f.storage.fullBookExecution.claim({
      consentId: f.budget.id,
      token: randomUUID(),
      now: clock.now,
      expiresAt: clock.expiresAt,
    })
    if (!lease) throw new TypeError("Missing synthetic recovery lease")
    const { attempt } = f.storage.fullBookExecution.reserve({
      lease,
      now: clock.now,
      threadId: "unstarted-synthetic-history",
      rpcId: 3,
    })
    f.storage.fullBookExecution.interrupt({ lease, attemptId: attempt.id })
    const before = f.storage.fullBookExecution.attempts(f.budget.id)
    f.closeStorage()

    const policy = FullBookManagedPolicy.parse({
      ...f.grant.policy,
      build: {
        kind: "pinned-codex",
        binaryPath: "/synthetic/not-installed/native-history",
        ...PINNED_CODEX_BUILD,
      },
    })
    const grant = FullBookManagedConsent.parse({
      ...f.grant,
      policy,
      reviewAcknowledgement: {
        ...f.grant.reviewAcknowledgement,
        runtimeBinding: contentDigest(JSON.stringify(policy)),
      },
    })
    const amendment = FullBookRecoveryAmendment.parse({
      ...f.amendment,
      nativeBinding: contentDigest(JSON.stringify(grant)),
      scopeBinding: contentDigest(JSON.stringify(fullBookNativeScope({ grant, budget: f.budget }))),
    })
    const db = new FixtureDatabase(f.options.databasePath)
    try {
      // Fixture-only conversion represents pre-existing native history; production has no authority setter.
      const triggers = z
        .array(z.object({ name: z.string(), sql: z.string() }))
        .parse(
          db
            .prepare(
              "SELECT name,sql FROM sqlite_master WHERE name IN ('managed_consent_no_update','recovery_no_update')",
            )
            .all(),
        )
      expect(triggers).toHaveLength(2)
      db.transaction(() => {
        for (const trigger of triggers) db.exec(`DROP TRIGGER "${trigger.name}"`)
        db.prepare("UPDATE full_book_managed_consents SET record_json=? WHERE id=?").run(
          JSON.stringify(grant),
          grant.id,
        )
        db.prepare("UPDATE full_book_recoveries SET record_json=? WHERE id=?").run(
          JSON.stringify(amendment),
          amendment.id,
        )
        for (const trigger of triggers) db.exec(trigger.sql)
      })()
    } finally {
      db.close()
    }

    // When the real repository reopens the saved native history, no client or provider is available.
    const restored = openStorage(f.options)
    try {
      // Then reading preserves every charge while the published composition still denies execution.
      expect(restored.fullBookExecution.attempts(f.budget.id)).toEqual(before)
      expect(before.map((item) => item.reservation)).toEqual([1, 2, 3])
      expect(before.map((item) => item.state)).toEqual([
        "outcome_unknown",
        "outcome_unknown",
        "outcome_unknown",
      ])
      expect(restored.fullBookRecovery.inspect(f.budget.id)).toMatchObject({
        state: "consumed",
        originalCeiling: f.budget.sourceCeiling,
        effectiveCeiling: f.budget.sourceCeiling + 1,
        attemptId: attempt.id,
      })
      expect(
        restored.fullBookManagedConsents.inspect({
          id: grant.id,
          owner: f.budget.ownerId,
          setupId: f.budget.setupRevisionId,
        }),
      ).not.toBeNull()
      expect(
        fullBookNativeReleased(
          grant.policy.build,
          fullBookNativeScope({ grant, budget: f.budget }),
        ),
      ).toBe(false)
      await expect(
        restored.fullBookManaged.run(grant.id, {
          signal: new AbortController().signal,
          now: () => clock.now,
        }),
      ).rejects.toThrow("disabled")
      expect(restored.fullBookExecution.attempts(f.budget.id)).toEqual(before)
    } finally {
      restored.close()
    }
  } finally {
    f.cleanup()
  }
})
