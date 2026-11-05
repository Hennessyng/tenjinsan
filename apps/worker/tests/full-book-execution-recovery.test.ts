import { randomUUID } from "node:crypto"
import { openStorage } from "@reading-studio/storage"
import { expect, it } from "vitest"
import {
  admittedExecution,
  executionClock as clock,
  nextExecution,
  syntheticReplyMetadata,
} from "./full-book-execution-fixture.ts"
import { pluralMapOutput } from "./full-book-test-fixture.ts"

it.each(["prepared", "dispatching"])(
  "retains a %s charge after lease expiry without automatic replay",
  (stage) => {
    // Given one charged attempt at the selected crash boundary.
    const f = admittedExecution()
    try {
      const prepared = nextExecution(f)
      if (stage === "dispatching")
        f.storage.fullBookExecution.beforeWrite({
          lease: prepared.lease,
          attemptId: prepared.attempt.id,
          now: clock.now,
        })
      const second = openStorage(f.options)
      try {
        // When another storage instance recovers the expired claim.
        expect(
          second.fullBookExecution.recover({ consentId: f.consent.id, now: clock.later }),
        ).toBe(1)
        // Then the attempt remains charged/unknown and cannot be silently replayed.
        expect(second.fullBookExecution.attempts(f.consent.id)[0]).toMatchObject({
          state: "outcome_unknown",
          resolution: "awaiting-owner",
        })
        expect(
          second.fullBookExecution.claim({
            consentId: f.consent.id,
            token: randomUUID(),
            now: clock.later,
            expiresAt: clock.laterExpiry,
          }),
        ).toBeNull()
        expect(
          second.fullBookConsent.commitments(
            f.consent.ownerId,
            f.consent.session.input.normalization.editionHash,
          ).spent,
        ).toBe(1)
      } finally {
        second.close()
      }
    } finally {
      f.cleanup()
    }
  },
)

it("allows only the second counted schema-repair attempt and never a third", () => {
  // Given a malformed received response under a canonical claimed job.
  const f = admittedExecution()
  try {
    for (let ordinal = 1; ordinal <= 2; ordinal++) {
      const prepared = nextExecution(f)
      f.storage.fullBookExecution.beforeWrite({
        lease: prepared.lease,
        attemptId: prepared.attempt.id,
        now: clock.now,
      })
      f.storage.fullBookExecution.receive({
        attemptId: prepared.attempt.id,
        dispatchKey: prepared.wire.dispatchKey,
        serialized: "{",
        usage: { kind: "known", inputTokens: ordinal, outputTokens: ordinal },
        receivedAt: clock.now,
        metadata: syntheticReplyMetadata(prepared.wire),
      })
      // When the malformed response reaches schema acceptance.
      expect(
        f.storage.fullBookExecution.accept({
          lease: prepared.lease,
          attemptId: prepared.attempt.id,
          now: clock.now,
        }).kind,
      ).toBe(ordinal === 1 ? "repair-required" : "rejected")
      expect(prepared.wire.repair).toBe(ordinal === 2)
    }
    // Then repairs consumed exactly two external attempts and no third can be claimed.
    expect(f.storage.fullBookExecution.attempts(f.consent.id)).toHaveLength(2)
    expect(
      f.storage.fullBookExecution.claim({
        consentId: f.consent.id,
        token: randomUUID(),
        now: clock.now,
        expiresAt: clock.expiresAt,
      }),
    ).toBeNull()
  } finally {
    f.cleanup()
  }
})

it("requires owner retry for unknown work and retains both charges when the second attempt is also unknown", () => {
  // Given one unknown attempt that cannot be automatically replayed.
  const f = admittedExecution()
  try {
    const first = nextExecution(f)
    f.storage.fullBookExecution.beforeWrite({
      lease: first.lease,
      attemptId: first.attempt.id,
      now: clock.now,
    })
    f.storage.fullBookExecution.recover({ consentId: f.consent.id, now: clock.later })
    // When the owner approves exactly one retry and the process again loses its outcome.
    f.storage.fullBookExecution.resolve({ attemptId: first.attempt.id, decision: "retry" })
    const second = nextExecution(f, true)
    f.storage.fullBookExecution.beforeWrite({
      lease: second.lease,
      attemptId: second.attempt.id,
      now: clock.later,
    })
    f.storage.fullBookExecution.recover({
      consentId: f.consent.id,
      now: "2026-10-31T00:04:00.000Z",
    })
    // Then a third retry is refused without refunding either charge.
    expect(() =>
      f.storage.fullBookExecution.resolve({ attemptId: second.attempt.id, decision: "retry" }),
    ).toThrow()
    expect(
      f.storage.fullBookConsent.commitments(
        f.consent.ownerId,
        f.consent.session.input.normalization.editionHash,
      ).spent,
    ).toBe(2)
  } finally {
    f.cleanup()
  }
})

it("preserves known usage for an interrupted received item without accepting it as terminal success", () => {
  // Given a received item with real known usage but an interrupted terminal status.
  const f = admittedExecution()
  try {
    const prepared = nextExecution(f)
    f.storage.fullBookExecution.beforeWrite({
      lease: prepared.lease,
      attemptId: prepared.attempt.id,
      now: clock.now,
    })
    f.storage.fullBookExecution.receive({
      attemptId: prepared.attempt.id,
      dispatchKey: prepared.wire.dispatchKey,
      serialized: JSON.stringify(pluralMapOutput(f.consent.session)),
      usage: { kind: "known", inputTokens: 9, outputTokens: 4 },
      receivedAt: clock.now,
      metadata: syntheticReplyMetadata(prepared.wire, "interrupted"),
    })
    // When completion is attempted.
    expect(
      f.storage.fullBookExecution.accept({
        lease: prepared.lease,
        attemptId: prepared.attempt.id,
        now: clock.now,
      }).kind,
    ).toBe("rejected")
    // Then exact received usage survives but no output receipt is accepted.
    expect(f.storage.fullBookExecution.attempts(f.consent.id)[0]).toMatchObject({
      state: "response-received",
      usage: { kind: "known", inputTokens: 9, outputTokens: 4 },
    })
    expect(f.storage.fullBookExecution.receipts(f.consent.id)).toHaveLength(0)
  } finally {
    f.cleanup()
  }
})

it("closes the plan on an explicit owner stop while retaining the unknown charge", () => {
  // Given one expired charged attempt awaiting the owner's decision.
  const f = admittedExecution()
  try {
    const prepared = nextExecution(f)
    f.storage.fullBookExecution.recover({ consentId: f.consent.id, now: clock.later })
    // When the owner explicitly chooses stop.
    f.storage.fullBookExecution.resolve({ attemptId: prepared.attempt.id, decision: "stop" })
    // Then unissued holds are released, but the unknown attempt remains charged and cannot replay.
    expect(
      f.storage.fullBookConsent.commitments(
        f.consent.ownerId,
        f.consent.session.input.normalization.editionHash,
      ),
    ).toEqual({ spent: 1, held: 0 })
    expect(f.storage.fullBookExecution.attempts(f.consent.id)[0]).toMatchObject({
      state: "outcome_unknown",
      resolution: "stop-approved",
    })
    expect(
      f.storage.fullBookExecution.claim({
        consentId: f.consent.id,
        token: randomUUID(),
        now: clock.later,
        expiresAt: clock.laterExpiry,
      }),
    ).toBeNull()
  } finally {
    f.cleanup()
  }
})

it("recovers at an equal instant even when ISO timestamp precision differs", () => {
  // Given a charged lease whose expiry omits optional fractional seconds.
  const f = admittedExecution()
  try {
    const lease = f.storage.fullBookExecution.claim({
      consentId: f.consent.id,
      token: randomUUID(),
      now: clock.now,
      expiresAt: "2026-10-31T00:01:00Z",
    })
    if (!lease) throw new TypeError("Missing precision fixture claim")
    f.storage.fullBookExecution.reserve({
      lease,
      now: clock.now,
      threadId: "synthetic-thread",
      rpcId: 1,
    })
    // When recovery uses a millisecond spelling of the same instant.
    expect(
      f.storage.fullBookExecution.recover({
        consentId: f.consent.id,
        now: "2026-10-31T00:01:00.000Z",
      }),
    ).toBe(1)
    // Then the expired prepared attempt is retained as unknown rather than silently skipped.
    expect(f.storage.fullBookExecution.attempts(f.consent.id)[0]).toMatchObject({
      state: "outcome_unknown",
      resolution: "awaiting-owner",
    })
  } finally {
    f.cleanup()
  }
})
