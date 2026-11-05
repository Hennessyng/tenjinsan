import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { captureLibrary, openStorage } from "@reading-studio/storage"
import { FixtureDatabase as Database, restoreLibrary } from "@reading-studio/storage/test-support"
import { expect, it } from "vitest"
import { portableDestination, portableFixture } from "./full-book-portable-fixture.ts"

it("rechecks source stability inside the frozen snapshot instead of exporting an approval added during drain", () => {
  // Given a closed portable scope and the existing maintenance progress hook.
  const f = portableFixture()
  try {
    const next = { ...f.consent, id: randomUUID() }
    // When a distinct synthetic approval is committed between preflight and snapshot freeze.
    expect(() =>
      captureLibrary(f.options, 30_000, (phase) => {
        if (phase === "draining") f.storage.fullBookConsent.approve(next)
      }),
    ).toThrow("active or owner-unresolved")
    // Then export refused without undoing that approval or refunding the earlier charge.
    expect(f.storage.fullBookConsent.read(next.id)).toEqual(next)
    expect(
      f.storage.fullBookConsent.commitments(
        f.consent.ownerId,
        f.consent.session.input.normalization.editionHash,
      ),
    ).toEqual({ spent: 1, held: f.consent.session.plan.maxAttempts })
    expect(f.storage.maintenance.phase()).toBe("idle")
  } finally {
    f.cleanup()
  }
})

it("rolls back source, owner-installation, charges and installed blobs when destination commit rejects a validated import", () => {
  // Given a valid archive and a disposable destination that rejects its final historical-index insertion.
  const f = portableFixture(),
    destination = portableDestination()
  try {
    const bytes = captureLibrary(f.options),
      db = new Database(destination.options.databasePath)
    try {
      db.exec(
        "CREATE TRIGGER test_refuse_portable_import BEFORE INSERT ON full_book_imports BEGIN SELECT RAISE(ABORT,'synthetic late-commit rejection'); END",
      )
    } finally {
      db.close()
    }
    // When the real restore transaction reaches that late failure after validation and blob staging.
    expect(() => restoreLibrary(destination.options, bytes)).toThrow(
      "synthetic late-commit rejection",
    )
    // Then no partially restored data, capability, charge or new blob remains.
    const restored = openStorage(destination.options)
    try {
      expect(restored.counts()).toMatchObject({
        editions: 0,
        studies: 0,
        runs: 0,
        attempts: 0,
        jobs: 0,
      })
      expect(restored.sources.getInstallation(destination.owner)).toBeNull()
      expect(
        restored.fullBookConsent.commitments(
          destination.owner,
          f.consent.session.input.normalization.editionHash,
        ),
      ).toEqual({ spent: 0, held: 0 })
      expect(
        existsSync(restored.blobs.pathFor(f.consent.session.input.normalization.editionHash)),
      ).toBe(false)
      expect(restored.maintenance.phase()).toBe("idle")
    } finally {
      restored.close()
    }
  } finally {
    destination.cleanup()
    f.cleanup()
  }
})
