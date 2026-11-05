import { randomUUID } from "node:crypto"
import { openStorage } from "@reading-studio/storage"
import { FixtureDatabase as Database } from "@reading-studio/storage/test-support"
import { expect, it } from "vitest"
import { durableConsentFixture } from "./full-book-durable-fixture.ts"

it("atomically persists exact experimental consent and its entire finite plan reservation", () => {
  // Given an authoritative persisted source and acknowledgement of all thirteen omissions.
  const fixture = durableConsentFixture()
  try {
    // When a synthetic-only plan is admitted.
    const admitted = fixture.storage.fullBookConsent.approve(fixture.consent)
    // Then exact reader/source/model/settings/limits and pending slots survive another connection.
    const second = openStorage(fixture.options)
    try {
      expect(second.fullBookConsent.read(fixture.consent.id)).toEqual(fixture.consent)
      expect(admitted.spent).toBe(0)
      expect(admitted.held).toBe(fixture.consent.session.plan.maxAttempts)
      expect(admitted.budgetVersion).toBe(1)
    } finally {
      second.close()
    }
  } finally {
    fixture.cleanup()
  }
})

it.each(["omission", "owner", "model", "destination", "source", "ceiling"])(
  "refuses %s mismatch without saving approval",
  (damage) => {
    // Given a valid source with one invalid consent binding.
    const fixture = durableConsentFixture(),
      consent = fixture.consent
    try {
      let changed: unknown
      switch (damage) {
        case "omission":
          changed = { ...consent, acknowledgement: { ...consent.acknowledgement, omissions: [] } }
          break
        case "owner":
          changed = { ...consent, ownerId: "foreign" }
          break
        case "model":
          changed = { ...consent, session: { ...consent.session, model: "other-model" } }
          break
        case "destination":
          changed = {
            ...consent,
            session: {
              ...consent.session,
              destination: { ...consent.session.destination, accountId: "foreign" },
            },
          }
          break
        case "source":
          changed = {
            ...consent,
            session: {
              ...consent.session,
              input: {
                ...consent.session.input,
                normalization: { ...consent.session.input.normalization, omissions: [] },
              },
            },
          }
          break
        case "ceiling":
          changed = { ...consent, sourceCeiling: consent.session.plan.maxAttempts - 1 }
          break
        default:
          throw new TypeError("Unknown fixture")
      }
      // When/Then failed admission leaves no active reservation.
      expect(() => fixture.storage.fullBookConsent.approve(changed)).toThrow()
      expect(fixture.storage.fullBookConsent.approve(consent).budgetVersion).toBe(1)
    } finally {
      fixture.cleanup()
    }
  },
)

it("allows one active source approval across connections and rejects immutable-record mutation", () => {
  // Given one active source plan and a concurrent storage instance.
  const fixture = durableConsentFixture(),
    second = openStorage(fixture.options)
  try {
    fixture.storage.fullBookConsent.approve(fixture.consent)
    // When/Then another purpose/session cannot create a parallel allowance pool.
    expect(() =>
      second.fullBookConsent.approve({ ...fixture.consent, id: randomUUID(), sourceCeiling: 100 }),
    ).toThrow()
    const db = new Database(fixture.options.databasePath)
    try {
      expect(() => db.prepare("UPDATE full_book_consents SET record_json='{}'").run()).toThrow()
    } finally {
      db.close()
    }
  } finally {
    second.close()
    fixture.cleanup()
  }
})

it("rechecks current authority when reading a previously valid immutable consent", () => {
  // Given an active source consent.
  const fixture = durableConsentFixture()
  try {
    fixture.storage.fullBookConsent.approve(fixture.consent)
    // When the owner disconnects the managed route.
    fixture.storage.subscriptionConnections.disconnect(
      fixture.consent.session.destination.installationId,
      "chatgpt-subscription",
    )
    // Then saved approval does not authorize current work.
    expect(() => fixture.storage.fullBookConsent.read(fixture.consent.id)).toThrow()
  } finally {
    fixture.cleanup()
  }
})
