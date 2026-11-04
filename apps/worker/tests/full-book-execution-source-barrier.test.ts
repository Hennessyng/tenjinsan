import { randomUUID } from "node:crypto"
import { completeGraphFixtures } from "@reading-studio/storage/test-support"
import { expect, it } from "vitest"
import { durableConsentFixture } from "./full-book-durable-fixture.ts"
import { executionClock as clock, nextExecution } from "./full-book-execution-fixture.ts"

it("keeps ordinary work blocked after consent closure until an unknown experimental attempt has an owner decision", () => {
  // Given ordinary queued work and an experimental dispatch marker for the same owner/source.
  const f = durableConsentFixture()
  try {
    const graph = completeGraphFixtures("openrouter")
    const grant = f.storage.sources.appendGrant({
      ...graph.grant,
      id: "ordinary-prior-grant",
      setupRevisionId: f.setup.id,
      ownerId: f.consent.ownerId,
      installationId: f.consent.session.destination.installationId,
      destination: f.consent.session.destination,
    })
    const inputRevisionId = f.storage.workflow.ensureAnalysisInput(f.setup.id)
    f.storage.execution.appendRun({
      id: "ordinary-prior-run",
      inputRevisionId,
      budget: { maxCalls: 20 },
      reservedCalls: 0,
      state: "running",
    })
    f.storage.execution.appendJob({
      ...graph.job,
      id: "ordinary-prior-job",
      runId: "ordinary-prior-run",
      inputRevisionId,
      setupRevisionId: f.setup.id,
      grant,
      provider: "chatgpt-subscription",
      model: f.setup.analysis.model,
      stage: "analysis",
      state: "queued",
    })
    f.storage.fullBookConsent.approve(f.consent)
    const prepared = nextExecution(f)
    f.storage.fullBookExecution.beforeWrite({
      lease: prepared.lease,
      attemptId: prepared.attempt.id,
      now: clock.now,
    })
    f.storage.fullBookConsent.close(
      f.consent.id,
      "Synthetic approval closure does not erase in-flight work",
    )
    // When ordinary work tries to claim while the experiment's result is still unresolved.
    expect(() =>
      f.storage.execution.claimNextJob({
        token: randomUUID(),
        now: clock.now,
        expiresAt: clock.expiresAt,
      }),
    ).toThrow()
    // Then only an explicit owner stop releases the source barrier, never the existing charge.
    f.storage.fullBookExecution.recover({ consentId: f.consent.id, now: clock.later })
    f.storage.fullBookExecution.resolve({ attemptId: prepared.attempt.id, decision: "stop" })
    expect(
      f.storage.execution.claimNextJob({
        token: randomUUID(),
        now: clock.later,
        expiresAt: clock.laterExpiry,
      }),
    ).toMatchObject({ id: "ordinary-prior-job", state: "running" })
    expect(
      f.storage.fullBookConsent.commitments(
        f.consent.ownerId,
        f.consent.session.input.normalization.editionHash,
      ),
    ).toEqual({ spent: 1, held: 0 })
    expect(
      f.storage.liveStudyBudget.analysisAllowance(
        f.consent.ownerId,
        f.consent.session.input.normalization.editionHash,
      ),
    ).toBe(19)
  } finally {
    f.cleanup()
  }
})
