import { randomUUID } from "node:crypto"
import { contentDigest, FullBookAnalysisOutput } from "@reading-studio/contracts"
import { openStorage } from "@reading-studio/storage"
import { FixtureDatabase as Database } from "@reading-studio/storage/test-support"
import { expect, it } from "vitest"
import { inheritedConsentFixture } from "./full-book-budget-fixture.ts"
import {
  admittedExecution,
  executionClock as clock,
  nextExecution,
  syntheticReplyMetadata,
} from "./full-book-execution-fixture.ts"
import { pluralMapOutput } from "./full-book-test-fixture.ts"

it("revalidates persisted output lineage on reopen even when corrupted receipt/body hashes agree", () => {
  // Given a valid durable map receipt, followed by deliberate corruption in this disposable database.
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
      usage: { kind: "known", inputTokens: 6, outputTokens: 3 },
      receivedAt: clock.now,
      metadata: syntheticReplyMetadata(prepared.wire),
    })
    f.storage.fullBookExecution.accept({
      lease: prepared.lease,
      attemptId: prepared.attempt.id,
      now: clock.now,
    })
    const receipt = f.storage.fullBookExecution.receipts(f.consent.id)[0]
    if (!receipt) throw new TypeError("Missing accepted fixture receipt")
    const output = FullBookAnalysisOutput.parse(JSON.parse(receipt.serialized))
    const serialized = JSON.stringify({ ...output, groupIds: output.groupIds.slice(0, 1) }),
      hash = contentDigest(serialized)
    f.closeStorage()
    const db = new Database(f.options.databasePath)
    try {
      db.pragma("foreign_keys = ON")
      db.pragma("recursive_triggers = ON")
      db.exec("DROP TRIGGER full_book_output_no_update; DROP TRIGGER full_book_attempt_identity")
      db.prepare("UPDATE full_book_output_receipts SET record_json=? WHERE attempt_id=?").run(
        JSON.stringify({ serialized, outputHash: hash }),
        prepared.attempt.id,
      )
      db.prepare(
        "UPDATE external_attempts SET record_json=json_set(record_json,'$.responseHash',?),response_body=? WHERE id=?",
      ).run(hash, Buffer.from(serialized), prepared.attempt.id)
    } finally {
      db.close()
    }
    // When another storage instance restores the internally hash-consistent corrupted record.
    const second = openStorage(f.options)
    try {
      // Then shared source/lineage validation refuses it, without refunding actual charged work.
      expect(() => second.fullBookExecution.receipts(f.consent.id)).toThrow()
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
})

it("projects experimental charges into the old cumulative twenty-slot status without rewriting its legacy counter", () => {
  // Given three retained old-mode attempts and one separately admitted experimental charge.
  const { legacy, consent } = inheritedConsentFixture(),
    storage = legacy.fixture.storage
  try {
    storage.liveStudyBudget.adopt(legacy.adoption)
    storage.fullBookConsent.approve(consent)
    const lease = storage.fullBookExecution.claim({
      consentId: consent.id,
      token: randomUUID(),
      now: clock.now,
      expiresAt: clock.expiresAt,
    })
    if (!lease) throw new TypeError("Missing experimental source claim")
    storage.fullBookExecution.reserve({
      lease,
      now: clock.now,
      threadId: "synthetic-thread",
      rpcId: 1,
    })
    // When the owner cancels the experiment before an actual native write.
    storage.fullBookExecution.cancel(
      consent.id,
      "Synthetic cancellation preserves the charged reservation",
    )
    // Then old grants see four spent slots and sixteen remaining, not a separate reset pool.
    expect(storage.liveStudyBudget.status(legacy.adoption.id)).toMatchObject({
      used: 4,
      remaining: 16,
      limit: 20,
    })
    const db = new Database(legacy.fixture.options.databasePath)
    try {
      expect(db.prepare("SELECT total_limit,reserved_total FROM live_study_budgets").get()).toEqual(
        { total_limit: 20, reserved_total: 3 },
      )
    } finally {
      db.close()
    }
  } finally {
    legacy.fixture.close()
  }
})
