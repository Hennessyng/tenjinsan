import { FixtureDatabase } from "@reading-studio/storage/test-support"
import { expect, it } from "vitest"
import { directOutput } from "./full-book-direct-output.ts"
import {
  admittedDirectExecution,
  executionClock as clock,
  nextExecution,
  syntheticReplyMetadata,
} from "./full-book-execution-fixture.ts"

it("rolls back the entire root acceptance and hold release if any unused-batch insert fails", () => {
  // Given a received root reply and a deliberate fault on the second local release record.
  const f = admittedDirectExecution()
  try {
    let root: ReturnType<typeof nextExecution> | undefined
    for (let index = 0; index < 2; index++) {
      const prepared = nextExecution(f),
        receipts = f.storage.fullBookExecution.receipts(f.consent.id)
      f.storage.fullBookExecution.beforeWrite({
        lease: prepared.lease,
        attemptId: prepared.attempt.id,
        now: clock.now,
      })
      f.storage.fullBookExecution.receive({
        attemptId: prepared.attempt.id,
        dispatchKey: prepared.wire.dispatchKey,
        serialized: JSON.stringify(directOutput(f.consent.session, receipts)),
        usage: { kind: "known", inputTokens: 10, outputTokens: 5 },
        receivedAt: clock.now,
        metadata: syntheticReplyMetadata(prepared.wire),
      })
      if (index === 0)
        expect(
          f.storage.fullBookExecution.accept({
            lease: prepared.lease,
            attemptId: prepared.attempt.id,
            now: clock.now,
          }),
        ).toEqual({ kind: "accepted" })
      else root = prepared
    }
    if (!root) throw new TypeError("Missing received root fixture")
    const db = new FixtureDatabase(f.options.databasePath)
    try {
      db.exec(
        "CREATE TRIGGER synthetic_vacate_fault BEFORE INSERT ON full_book_not_needed WHEN (SELECT COUNT(*) FROM full_book_not_needed)=1 BEGIN SELECT RAISE(ABORT,'synthetic release failure'); END",
      )
      // When acceptance fails halfway through release, then no root or partial refund is committed.
      expect(() =>
        f.storage.fullBookExecution.accept({
          lease: root.lease,
          attemptId: root.attempt.id,
          now: clock.now,
        }),
      ).toThrow("synthetic release failure")
      expect(f.storage.fullBookExecution.receipts(f.consent.id)).toHaveLength(1)
      expect(
        f.storage.fullBookConsent.commitments(
          f.consent.ownerId,
          f.consent.session.input.normalization.editionHash,
        ),
      ).toEqual({ spent: 2, held: 12 })
      db.exec("DROP TRIGGER synthetic_vacate_fault")
      expect(
        f.storage.fullBookExecution.accept({
          lease: root.lease,
          attemptId: root.attempt.id,
          now: clock.now,
        }),
      ).toEqual({ kind: "accepted" })
      expect(
        f.storage.fullBookConsent.commitments(
          f.consent.ownerId,
          f.consent.session.input.normalization.editionHash,
        ),
      ).toEqual({ spent: 2, held: 8 })
    } finally {
      db.close()
    }
  } finally {
    f.cleanup()
  }
})
