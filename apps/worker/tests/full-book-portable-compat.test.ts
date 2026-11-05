import { contentDigest } from "@reading-studio/contracts"
import { captureLibrary, openStorage } from "@reading-studio/storage"
import { Archive, restoreLibrary } from "@reading-studio/storage/test-support"
import { expect, it } from "vitest"
import { durableConsentFixture } from "./full-book-durable-fixture.ts"
import {
  admittedExecution,
  executionClock as clock,
  nextExecution,
} from "./full-book-execution-fixture.ts"
import { portableDestination } from "./full-book-portable-fixture.ts"

it("restores the legacy version-one/schema-eleven format with source identity and inert destination fences", () => {
  // Given an ordinary library in the exact pre-experimental archive table format.
  const f = durableConsentFixture(),
    destination = portableDestination()
  try {
    const captured = Archive.parse(JSON.parse(captureLibrary(f.options).toString("utf8")))
    const payload = {
      ...captured.payload,
      schemaVersion: 11,
      tables: captured.payload.tables.filter((table) => table.name !== "full_book_imports"),
    }
    const bytes = Buffer.from(
      JSON.stringify({ payload, digest: contentDigest(JSON.stringify(payload)) }),
    )
    // When the unchanged archive-format version is imported.
    restoreLibrary(destination.options, bytes)
    const restored = openStorage(destination.options)
    try {
      // Then source IDs/text remain unchanged, the new owner owns the study and old destination is fenced.
      expect(restored.sources.getNormalization(f.consent.session.input.normalization.id)).toEqual(
        f.consent.session.input.normalization,
      )
      expect(restored.sources.listStudiesByEdition(f.setup.editionId)[0]?.ownerId).toBe(
        destination.owner,
      )
      expect(restored.sources.getSetup(f.setup.id)?.analysis.destination?.connectionRevision).toBe(
        Number.MAX_SAFE_INTEGER,
      )
      expect(
        restored.fullBookConsent.commitments(
          destination.owner,
          f.consent.session.input.normalization.editionHash,
        ),
      ).toEqual({ spent: 0, held: 0 })
    } finally {
      restored.close()
    }
  } finally {
    destination.cleanup()
    f.cleanup()
  }
})

it.each(["active", "owner-unresolved"])(
  "explicitly refuses %s export rather than silently omitting scope",
  (state) => {
    // Given a synthetic scope that is not a closed owner-decided snapshot.
    const f = admittedExecution()
    try {
      if (state === "owner-unresolved") {
        const prepared = nextExecution(f)
        f.storage.fullBookExecution.beforeWrite({
          lease: prepared.lease,
          attemptId: prepared.attempt.id,
          now: clock.now,
        })
        f.storage.fullBookExecution.recover({ consentId: f.consent.id, now: clock.later })
        f.storage.fullBookConsent.close(
          f.consent.id,
          "Closure alone is not an unknown-attempt owner decision",
        )
      }
      const before = f.storage.fullBookConsent.commitments(
        f.consent.ownerId,
        f.consent.session.input.normalization.editionHash,
      )
      // When/Then stable-phase export refuses, preserving all charges and pending reservations.
      expect(() => captureLibrary(f.options)).toThrow("active or owner-unresolved")
      expect(
        f.storage.fullBookConsent.commitments(
          f.consent.ownerId,
          f.consent.session.input.normalization.editionHash,
        ),
      ).toEqual(before)
    } finally {
      f.cleanup()
    }
  },
)
