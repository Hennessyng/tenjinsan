import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { contentDigest, FullBookTestConsent, FullBookTestSession } from "@reading-studio/contracts"
import { captureLibrary, openStorage } from "@reading-studio/storage"
import {
  Archive,
  FixtureDatabase as Database,
  restoreLibrary,
} from "@reading-studio/storage/test-support"
import { expect, it } from "vitest"
import { z } from "zod"
import { executionClock as clock } from "./full-book-execution-fixture.ts"
import { portableDestination, portableFixture } from "./full-book-portable-fixture.ts"

it.each([true, false])(
  "ports closed experimental history with known usage=%s as non-executable audit without refunding its source charge",
  (known) => {
    // Given a closed synthetic scope with its actual wire, events and one counted attempt.
    const f = portableFixture(known),
      destination = portableDestination()
    try {
      // When the existing archive pipeline exports and restores the entire source library.
      const bytes = captureLibrary(f.options)
      const archive = Archive.parse(JSON.parse(bytes.toString("utf8")))
      expect(archive.payload.version).toBe(1)
      expect(archive.payload.schemaVersion).toBe(12)
      restoreLibrary(destination.options, bytes)
      const restored = openStorage(destination.options)
      try {
        // Then original protected wire identities remain immutable audit data, never resume capabilities.
        expect(
          restored.fullBookConsent.commitments(
            destination.owner,
            f.consent.session.input.normalization.editionHash,
          ),
        ).toEqual({ spent: 1, held: 0 })
        expect(() =>
          restored.fullBookExecution.claim({
            consentId: f.consent.id,
            token: randomUUID(),
            now: clock.now,
            expiresAt: clock.expiresAt,
          }),
        ).toThrow()
        expect(() =>
          restored.fullBookExecution.beforeWrite({
            lease: f.prepared.lease,
            attemptId: f.prepared.attempt.id,
            now: clock.now,
          }),
        ).toThrow()
        const imports = archive.payload.tables.find(
          (table) => table.name === "full_book_imports",
        )?.rows
        expect(imports).toHaveLength(1)
        const row = imports?.[0]
        if (!row) throw new TypeError("Missing portable import")
        const hash = z.string().parse(row["id"])
        const blob = archive.payload.blobs.find((blob) => blob.hash === hash)
        if (!blob) throw new TypeError("Missing protected audit blob")
        expect(contentDigest(readFileSync(restored.blobs.pathFor(hash)).toString("utf8"))).toBe(
          hash,
        )
        const audit = z
          .object({ wires: z.array(z.object({ record_json: z.string() })) })
          .parse(JSON.parse(Buffer.from(blob.bytes, "base64").toString("utf8")))
        expect(audit.wires[0]?.record_json).toBe(JSON.stringify(f.prepared.wire))
        expect(restored.sources.getInstallation(destination.owner)).not.toBe(
          f.consent.session.destination.installationId,
        )
        const recaptured = Archive.parse(
          JSON.parse(captureLibrary(destination.options).toString("utf8")),
        )
        expect(
          recaptured.payload.tables.find((table) => table.name === "full_book_imports")?.rows,
        ).toHaveLength(1)
        expect(
          restored.fullBookConsent.commitments(
            destination.owner,
            f.consent.session.input.normalization.editionHash,
          ).spent,
        ).toBe(1)
      } finally {
        restored.close()
      }
      const db = new Database(destination.options.databasePath)
      try {
        db.pragma("foreign_keys = ON")
        db.pragma("recursive_triggers = ON")
        expect(() =>
          db
            .prepare("UPDATE external_attempts SET record_json=record_json WHERE id=?")
            .run(f.prepared.attempt.id),
        ).toThrow("not capabilities")
        expect(() =>
          db
            .prepare("UPDATE generation_runs SET state='running' WHERE id=?")
            .run(f.prepared.attempt.runId),
        ).toThrow("non-executable")
        expect(() =>
          db
            .prepare(
              "INSERT INTO external_attempts(id,run_id,input_revision_id,state,reservation,record_json) VALUES (?,?,?,'prepared',2,'{}')",
            )
            .run(randomUUID(), f.prepared.attempt.runId, f.prepared.attempt.inputRevisionId),
        ).toThrow("cannot reserve attempts")
      } finally {
        db.close()
      }
      const checked = openStorage(destination.options)
      try {
        expect(
          checked.fullBookConsent.commitments(
            destination.owner,
            f.consent.session.input.normalization.editionHash,
          ).spent,
        ).toBe(1)
      } finally {
        checked.close()
      }
    } finally {
      destination.cleanup()
      f.cleanup()
    }
  },
)

it("requires fresh consent and preserves the prior version and spending after identity remap", () => {
  // Given restored audit-only history under a fresh owner and installation.
  const f = portableFixture(),
    destination = portableDestination()
  try {
    restoreLibrary(destination.options, captureLibrary(f.options))
    const restored = openStorage(destination.options)
    try {
      const installation = restored.sources.getInstallation(destination.owner)
      if (!installation) throw new TypeError("Missing destination installation")
      const dest = {
        ...f.consent.session.destination,
        accountId: "synthetic-restored-account",
        installationId: installation,
        connectionRevision: 0,
      }
      const setup = {
        ...f.setup,
        id: "fresh-restored-draft",
        analysis: { ...f.setup.analysis, destination: dest },
      }
      restored.sources.appendSetup({ record: setup, parentRevisionId: f.setup.id })
      const session = FullBookTestSession.parse({ ...f.consent.session, destination: dest })
      const consent = FullBookTestConsent.parse({
        ...f.consent,
        id: randomUUID(),
        ownerId: destination.owner,
        setupRevisionId: setup.id,
        session,
        sourceCeiling: session.plan.maxAttempts,
      })
      // When admission would fit only if imported charges or version history were forgotten.
      expect(() => restored.fullBookConsent.approve(consent)).toThrow()
      expect(() =>
        restored.fullBookConsent.approve({
          ...consent,
          id: f.consent.id,
          sourceCeiling: consent.sourceCeiling + 1,
        }),
      ).toThrow("historical consent")
      // Then a separately supplied fitting ceiling admits version two, not a reset version/pool.
      expect(
        restored.fullBookConsent.approve({ ...consent, sourceCeiling: consent.sourceCeiling + 1 }),
      ).toMatchObject({ spent: 1, budgetVersion: 2 })
    } finally {
      restored.close()
    }
  } finally {
    destination.cleanup()
    f.cleanup()
  }
})
