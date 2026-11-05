import { randomUUID } from "node:crypto"
import { openStorage } from "@reading-studio/storage"
import {
  completeGraphFixtures,
  FixtureDatabase as Database,
} from "@reading-studio/storage/test-support"
import { expect, it } from "vitest"
import { inheritedConsentFixture } from "./full-book-budget-fixture.ts"

it("uses all previous owner/source attempts under a new synthetic ceiling without elevating old twenty-slot grants", () => {
  // Given three counted legacy attempts, including unknown usage, and a larger finite experimental plan.
  const { legacy, consent } = inheritedConsentFixture(),
    storage = legacy.fixture.storage
  try {
    storage.liveStudyBudget.adopt(legacy.adoption)
    expect(consent.session.plan.maxAttempts).toBeGreaterThan(20)
    const before = legacy.history()
    // When the new, separately consented synthetic ceiling reserves the whole experimental plan.
    const admitted = storage.fullBookConsent.approve(consent)
    // Then no existing attempt/grant is rewritten and the original ledger ceiling remains twenty.
    expect(admitted.spent).toBe(3)
    expect(
      storage.fullBookConsent.commitments(
        consent.ownerId,
        consent.session.input.normalization.editionHash,
      ),
    ).toEqual({ spent: 3, held: consent.session.plan.maxAttempts })
    expect(legacy.history()).toBe(before)
    const db = new Database(legacy.fixture.options.databasePath)
    try {
      expect(db.prepare("SELECT total_limit,reserved_total FROM live_study_budgets").get()).toEqual(
        { total_limit: 20, reserved_total: 3 },
      )
      expect(() =>
        db
          .prepare(
            "INSERT INTO jobs SELECT 'forbidden-job',run_id,input_revision_id,setup_revision_id,grant_id,'queued',checkpoint,cancellation_requested,lease_fence,lease_token,lease_expires_at,record_json FROM jobs LIMIT 1",
          )
          .run(),
      ).toThrow("experimental source reservation is exclusive")
    } finally {
      db.close()
    }
  } finally {
    legacy.fixture.close()
  }
})

it("rejects a ceiling that fits a new plan only if previous attempts were silently reset", () => {
  // Given historical attempts and an adopted cumulative owner/source ledger.
  const { legacy, consent } = inheritedConsentFixture(),
    storage = legacy.fixture.storage
  try {
    storage.liveStudyBudget.adopt(legacy.adoption)
    // When/Then a ceiling equal to only the new plan fails; the three earlier attempts still count.
    expect(() =>
      storage.fullBookConsent.approve({
        ...consent,
        sourceCeiling: consent.session.plan.maxAttempts,
      }),
    ).toThrow()
    expect(
      storage.fullBookConsent.commitments(
        consent.ownerId,
        consent.session.input.normalization.editionHash,
      ),
    ).toEqual({ spent: 3, held: 0 })
  } finally {
    legacy.fixture.close()
  }
})

it("retains spent history while closing an unexecuted reservation and admitting exactly one next budget version", () => {
  // Given a committed experimental reservation, with native execution still disabled.
  const { legacy, consent } = inheritedConsentFixture(),
    storage = legacy.fixture.storage
  try {
    storage.liveStudyBudget.adopt(legacy.adoption)
    storage.fullBookConsent.approve(consent)
    // When the owner closes this unexecuted plan and explicitly approves another version.
    storage.fullBookConsent.close(
      consent.id,
      "Synthetic owner cancellation before any experimental attempt",
    )
    const next = storage.fullBookConsent.approve({ ...consent, id: randomUUID() })
    // Then only unspent plan slots were released, and earlier attempts remain charged.
    expect(next.budgetVersion).toBe(2)
    expect(next.spent).toBe(3)
    expect(next.held).toBe(consent.session.plan.maxAttempts)
    expect(() => storage.fullBookConsent.read(consent.id)).toThrow()
    const second = openStorage(legacy.fixture.options)
    try {
      expect(() => second.fullBookConsent.approve({ ...consent, id: randomUUID() })).toThrow()
    } finally {
      second.close()
    }
  } finally {
    legacy.fixture.close()
  }
})

it("counts prepared/unknown reservations but refuses overlapping legacy in-flight work", () => {
  // Given a fourth prepared legacy attempt that already consumed a source slot.
  const { legacy, consent } = inheritedConsentFixture(),
    { fixture } = legacy,
    storage = fixture.storage
  try {
    const graph = completeGraphFixtures("openrouter"),
      setup = legacy.setup
    const grant = storage.sources.getGrant("grant-live")
    if (!grant) throw new TypeError("Missing old grant")
    const inputRevisionId = storage.workflow.ensureAnalysisInput(setup.id)
    storage.execution.appendRun({
      id: "pending-run",
      inputRevisionId,
      budget: { maxCalls: 2 },
      reservedCalls: 0,
      state: "running",
    })
    storage.execution.appendJob({
      ...graph.job,
      id: "pending-job",
      runId: "pending-run",
      inputRevisionId,
      setupRevisionId: setup.id,
      grant,
      provider: setup.analysis.provider,
      model: setup.analysis.model,
      stage: "analysis",
      state: "queued",
    })
    const lease = fixture.claim(),
      reserved = fixture.reserve(lease)
    if (reserved.kind !== "prepared") throw new TypeError("Missing counted reservation")
    expect(() =>
      storage.liveStudyBudget.adopt({
        ...legacy.adoption,
        members: legacy.adoption.members.map((member) => ({ ...member, expectedSpent: 4 })),
      }),
    ).toThrow("work-in-flight")
    // When/Then the prepared reservation is counted even though overlapping experimental admission fails.
    expect(
      storage.fullBookConsent.commitments(
        consent.ownerId,
        consent.session.input.normalization.editionHash,
      ),
    ).toEqual({ spent: 4, held: 0 })
    expect(() => storage.fullBookConsent.approve(consent)).toThrow()
  } finally {
    fixture.close()
  }
})
