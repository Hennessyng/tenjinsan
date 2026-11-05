import { randomUUID } from "node:crypto"
import { expect, it } from "vitest"
import {
  admittedExecution,
  executionClock as clock,
  nextExecution,
  syntheticReplyMetadata,
} from "./full-book-execution-fixture.ts"
import { pluralMapOutput } from "./full-book-test-fixture.ts"

it.each(["model", "settings", "source"])(
  "preserves received usage when %s changes before acceptance",
  (change) => {
    // Given a dispatched job whose draft authority changes before the received reply is accepted.
    const f = admittedExecution()
    try {
      const prepared = nextExecution(f)
      f.storage.fullBookExecution.beforeWrite({
        lease: prepared.lease,
        attemptId: prepared.attempt.id,
        now: clock.now,
      })
      let normalizationId = f.setup.analysis.normalizationRevisionId
      if (change === "source")
        normalizationId = f.storage.sources.appendNormalization({
          record: {
            ...f.consent.session.input.normalization,
            id: "new-authoritative-normalization",
          },
          parentRevisionId: normalizationId,
        }).id
      f.storage.sources.appendSetup({
        record: {
          ...f.setup,
          id: `new-${change}`,
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
      // When actual received body/usage is committed separately from semantic/authority acceptance.
      f.storage.fullBookExecution.receive({
        attemptId: prepared.attempt.id,
        dispatchKey: prepared.wire.dispatchKey,
        serialized: JSON.stringify(pluralMapOutput(f.consent.session)),
        usage: { kind: "known", inputTokens: 13, outputTokens: 8 },
        receivedAt: clock.now,
        metadata: syntheticReplyMetadata(prepared.wire),
      })
      // Then changed authority rejects acceptance but cannot erase or zero the received usage.
      expect(
        f.storage.fullBookExecution.accept({
          lease: prepared.lease,
          attemptId: prepared.attempt.id,
          now: clock.now,
        }).kind,
      ).toBe("authority-denied")
      expect(f.storage.fullBookExecution.attempts(f.consent.id)[0]).toMatchObject({
        state: "response-received",
        usage: { kind: "known", inputTokens: 13, outputTokens: 8 },
      })
    } finally {
      f.cleanup()
    }
  },
)

it("retains an unknown charge across cancellation and a new separately consented source budget version", () => {
  // Given one charged attempt that is cancelled before actual native writing.
  const f = admittedExecution()
  try {
    nextExecution(f)
    // When cancellation releases only unissued slots and another explicit synthetic consent is offered.
    f.storage.fullBookExecution.cancel(
      f.consent.id,
      "Synthetic cancellation retains unknown source spending",
    )
    f.storage.fullBookExecution.cancel(f.consent.id, "Repeated cancellation is idempotent")
    expect(
      f.storage.fullBookConsent.commitments(
        f.consent.ownerId,
        f.consent.session.input.normalization.editionHash,
      ),
    ).toEqual({ spent: 1, held: 0 })
    const next = {
      ...f.consent,
      id: randomUUID(),
      sourceCeiling: f.consent.session.plan.maxAttempts,
    }
    // Then the original unknown charge must fit alongside the entire new plan; no mode reset is possible.
    expect(() => f.storage.fullBookConsent.approve(next)).toThrow()
    expect(
      f.storage.fullBookConsent.approve({ ...next, sourceCeiling: next.sourceCeiling + 1 }),
    ).toMatchObject({ spent: 1, budgetVersion: 2 })
    expect(f.storage.fullBookExecution.attempts(f.consent.id)[0]).toMatchObject({
      state: "outcome_unknown",
      resolution: "stop-approved",
    })
  } finally {
    f.cleanup()
  }
})
