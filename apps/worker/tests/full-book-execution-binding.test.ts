import { randomUUID } from "node:crypto"
import { captureLibrary } from "@reading-studio/storage"
import { FixtureDatabase as Database } from "@reading-studio/storage/test-support"
import { expect, it } from "vitest"
import {
  admittedExecution,
  executionClock as clock,
  nextExecution,
  syntheticReplyMetadata,
} from "./full-book-execution-fixture.ts"
import { pluralMapOutput } from "./full-book-test-fixture.ts"

it.each(["forged-lease", "supplied-frame", "foreign-reply"])(
  "rejects %s without accepting arbitrary prepared work",
  (damage) => {
    // Given a canonical charged attempt and an independently corrupted API binding.
    const f = admittedExecution()
    try {
      const prepared = nextExecution(f)
      // When/Then no caller-supplied lease, wire or foreign metadata can bypass stored identities.
      switch (damage) {
        case "forged-lease":
          expect(() =>
            f.storage.fullBookExecution.beforeWrite({
              lease: { ...prepared.lease, token: randomUUID() },
              attemptId: prepared.attempt.id,
              now: clock.now,
            }),
          ).toThrow()
          break
        case "supplied-frame":
          expect(() =>
            f.storage.fullBookExecution.beforeWrite({
              lease: prepared.lease,
              attemptId: prepared.attempt.id,
              now: clock.now,
              frame: "forged",
            }),
          ).toThrow()
          break
        case "foreign-reply":
          f.storage.fullBookExecution.beforeWrite({
            lease: prepared.lease,
            attemptId: prepared.attempt.id,
            now: clock.now,
          })
          expect(() =>
            f.storage.fullBookExecution.receive({
              attemptId: prepared.attempt.id,
              dispatchKey: prepared.wire.dispatchKey,
              serialized: "{}",
              usage: { kind: "unknown" },
              receivedAt: clock.now,
              metadata: { ...syntheticReplyMetadata(prepared.wire), threadId: "foreign-thread" },
            }),
          ).toThrow()
          break
        default:
          throw new TypeError("Unknown fixture")
      }
      expect(f.storage.fullBookExecution.attempts(f.consent.id)).toHaveLength(1)
      expect(f.storage.fullBookExecution.receipts(f.consent.id)).toHaveLength(0)
    } finally {
      f.cleanup()
    }
  },
)

it("rejects raw attempt insertion without a canonical wire and rejects immutable wire mutation", () => {
  // Given an existing canonical run and its first persisted wire.
  const f = admittedExecution()
  try {
    const prepared = nextExecution(f),
      db = new Database(f.options.databasePath)
    try {
      // When/Then SQL cannot admit an unwired charge or replace the accepted request bytes.
      expect(() =>
        db
          .prepare(
            "INSERT INTO external_attempts(id,run_id,input_revision_id,state,reservation,record_json) VALUES (?,?,?,'prepared',2,'{}')",
          )
          .run(randomUUID(), prepared.attempt.runId, prepared.attempt.inputRevisionId),
      ).toThrow("canonical charged experimental wire required")
      expect(() =>
        db
          .prepare("UPDATE full_book_wires SET record_json='{}' WHERE attempt_id=?")
          .run(prepared.attempt.id),
      ).toThrow("immutable")
    } finally {
      db.close()
    }
    expect(f.storage.fullBookExecution.attempts(f.consent.id)).toHaveLength(1)
  } finally {
    f.cleanup()
  }
})

it.each(["cancel", "revoke", "model", "settings", "source"])(
  "rechecks %s before returning bytes for write",
  (change) => {
    // Given a charged, not-yet-written attempt.
    const f = admittedExecution()
    try {
      const prepared = nextExecution(f)
      switch (change) {
        case "cancel":
          f.storage.fullBookExecution.cancel(f.consent.id, "Synthetic owner cancellation")
          break
        case "revoke":
          f.storage.subscriptionConnections.disconnect(
            f.consent.session.destination.installationId,
            "chatgpt-subscription",
          )
          break
        case "model":
        case "settings":
        case "source": {
          let normalizationId = f.setup.analysis.normalizationRevisionId
          if (change === "source") {
            const normalization = {
              ...f.consent.session.input.normalization,
              id: "replacement-normalization",
            }
            normalizationId = f.storage.sources.appendNormalization({
              record: normalization,
              parentRevisionId: normalizationId,
            }).id
          }
          f.storage.sources.appendSetup({
            record: {
              ...f.setup,
              id: `draft-${change}`,
              analysis: {
                ...f.setup.analysis,
                normalizationRevisionId: normalizationId,
                ...(change === "model" ? { model: "changed-model" } : {}),
                ...(change === "settings"
                  ? { settings: { ...f.setup.analysis.settings, maxOutputTokens: 5000 } }
                  : {}),
              },
            },
            parentRevisionId: f.setup.id,
          })
          break
        }
        default:
          throw new TypeError("Unknown fixture")
      }
      // When/Then current authority fails before any wire can be returned; the existing charge remains.
      expect(() =>
        f.storage.fullBookExecution.beforeWrite({
          lease: prepared.lease,
          attemptId: prepared.attempt.id,
          now: clock.now,
        }),
      ).toThrow()
      expect(f.storage.fullBookExecution.attempts(f.consent.id)).toHaveLength(1)
      expect(
        f.storage.fullBookConsent.commitments(
          f.consent.ownerId,
          f.consent.session.input.normalization.editionHash,
        ).spent,
      ).toBe(1)
    } finally {
      f.cleanup()
    }
  },
)

it("rejects a source-bound output corruption before durable acceptance", () => {
  // Given an actual received map with a dropped represented group.
  const f = admittedExecution()
  try {
    const prepared = nextExecution(f),
      output = pluralMapOutput(f.consent.session)
    output.groupIds.pop()
    f.storage.fullBookExecution.beforeWrite({
      lease: prepared.lease,
      attemptId: prepared.attempt.id,
      now: clock.now,
    })
    f.storage.fullBookExecution.receive({
      attemptId: prepared.attempt.id,
      dispatchKey: prepared.wire.dispatchKey,
      serialized: JSON.stringify(output),
      usage: { kind: "known", inputTokens: 8, outputTokens: 4 },
      receivedAt: clock.now,
      metadata: syntheticReplyMetadata(prepared.wire),
    })
    // When/Then lineage refusal preserves receipt usage, but creates no accepted output.
    expect(
      f.storage.fullBookExecution.accept({
        lease: prepared.lease,
        attemptId: prepared.attempt.id,
        now: clock.now,
      }).kind,
    ).toBe("rejected")
    expect(f.storage.fullBookExecution.receipts(f.consent.id)).toHaveLength(0)
    expect(f.storage.fullBookExecution.attempts(f.consent.id)[0]).toMatchObject({
      state: "response-received",
      usage: { kind: "known", inputTokens: 8, outputTokens: 4 },
    })
  } finally {
    f.cleanup()
  }
})

it("blocks backups rather than emitting an archive that omits experimental history", () => {
  // Given durable experimental consent and a charged attempt, with portable support pending.
  const f = admittedExecution()
  try {
    nextExecution(f)
    // When/Then backup fails closed before any incomplete history can be exported.
    expect(() => captureLibrary(f.options)).toThrow(
      "experimental execution history is not yet portable",
    )
    expect(f.storage.fullBookExecution.attempts(f.consent.id)).toHaveLength(1)
  } finally {
    f.cleanup()
  }
})
