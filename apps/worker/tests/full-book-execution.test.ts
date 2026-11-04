import { randomUUID } from "node:crypto"
import { contentDigest } from "@reading-studio/contracts"
import { expect, it } from "vitest"
import { durableConsentFixture } from "./full-book-durable-fixture.ts"
import { pluralMapOutput } from "./full-book-test-fixture.ts"

const now = "2026-10-31T00:00:00.000Z",
  expiresAt = "2026-10-31T00:01:00.000Z"
it("charges the canonical job before write and atomically moves held slots into actual source spending", () => {
  // Given a separately consented synthetic plan with no experimental attempts.
  const f = durableConsentFixture()
  try {
    f.storage.fullBookConsent.approve(f.consent)
    // When the one eligible job is claimed and its exact frame reserved.
    const lease = f.storage.fullBookExecution.claim({
      consentId: f.consent.id,
      token: randomUUID(),
      now,
      expiresAt,
    })
    if (!lease) throw new TypeError("Missing synthetic claim")
    const prepared = f.storage.fullBookExecution.reserve({
      lease,
      now,
      threadId: "synthetic-thread",
      rpcId: 1,
    })
    // Then the ordinary external-attempt ledger is already charged and the same total remains committed.
    expect(prepared.attempt.state).toBe("prepared")
    expect(
      f.storage.fullBookConsent.commitments(
        f.consent.ownerId,
        f.consent.session.input.normalization.editionHash,
      ),
    ).toEqual({ spent: 1, held: f.consent.session.plan.maxAttempts - 1 })
    const frame = f.storage.fullBookExecution.beforeWrite({
      lease,
      attemptId: prepared.attempt.id,
      now,
    })
    expect(frame.hash).toBe(contentDigest(frame.serialized))
  } finally {
    f.cleanup()
  }
})

it("persists a received reply and known usage even when current authority fails before acceptance", () => {
  // Given a canonical charged dispatch and a later route revocation.
  const f = durableConsentFixture()
  try {
    f.storage.fullBookConsent.approve(f.consent)
    const lease = f.storage.fullBookExecution.claim({
      consentId: f.consent.id,
      token: randomUUID(),
      now,
      expiresAt,
    })
    if (!lease) throw new TypeError("Missing synthetic claim")
    const prepared = f.storage.fullBookExecution.reserve({
      lease,
      now,
      threadId: "synthetic-thread",
      rpcId: 1,
    })
    f.storage.fullBookExecution.beforeWrite({ lease, attemptId: prepared.attempt.id, now })
    f.storage.subscriptionConnections.disconnect(
      f.consent.session.destination.installationId,
      "chatgpt-subscription",
    )
    // When the actual received response is recorded before the acceptance authority check.
    f.storage.fullBookExecution.receive({
      attemptId: prepared.attempt.id,
      dispatchKey: prepared.wire.dispatchKey,
      serialized: JSON.stringify(pluralMapOutput(f.consent.session)),
      usage: { kind: "known", inputTokens: 7, outputTokens: 5 },
      receivedAt: now,
      metadata: {
        transport: "synthetic-only-no-native-entry",
        threadId: prepared.wire.threadId,
        requestId: prepared.wire.rpcId,
        wireHash: prepared.wire.hash,
        targetHash: prepared.wire.targetHash,
        turnId: "synthetic-turn",
        terminal: "completed",
      },
    })
    expect(
      f.storage.fullBookExecution.accept({ lease, attemptId: prepared.attempt.id, now }).kind,
    ).toBe("authority-denied")
    // Then received usage remains durable rather than reverting to unknown or zero.
    expect(f.storage.fullBookExecution.attempts(f.consent.id)[0]).toMatchObject({
      state: "response-received",
      usage: { kind: "known", inputTokens: 7, outputTokens: 5 },
    })
  } finally {
    f.cleanup()
  }
})
