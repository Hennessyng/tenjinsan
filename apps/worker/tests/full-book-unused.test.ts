import { randomUUID } from "node:crypto"
import { fullBookTestNotNeeded } from "@reading-studio/contracts"
import { captureLibrary, openStorage } from "@reading-studio/storage"
import { Archive, FixtureDatabase, restoreLibrary } from "@reading-studio/storage/test-support"
import { expect, it } from "vitest"
import { z } from "zod"
import { directOutput } from "./full-book-direct-output.ts"
import {
  executionClock as clock,
  admittedDirectExecution as given,
  nextExecution,
  syntheticReplyMetadata,
} from "./full-book-execution-fixture.ts"
import { portableDestination } from "./full-book-portable-fixture.ts"

function acceptNext(f: ReturnType<typeof given>, malformed = false) {
  const before = f.storage.fullBookExecution.receipts(f.consent.id),
    prepared = nextExecution(f)
  const output = directOutput(f.consent.session, before)
  f.storage.fullBookExecution.beforeWrite({
    lease: prepared.lease,
    attemptId: prepared.attempt.id,
    now: clock.now,
  })
  f.storage.fullBookExecution.receive({
    attemptId: prepared.attempt.id,
    dispatchKey: prepared.wire.dispatchKey,
    serialized: malformed ? "{" : JSON.stringify(output),
    usage: { kind: "known", inputTokens: 10, outputTokens: 5 },
    receivedAt: clock.now,
    metadata: syntheticReplyMetadata(prepared.wire),
  })
  expect(
    f.storage.fullBookExecution.accept({
      lease: prepared.lease,
      attemptId: prepared.attempt.id,
      now: clock.now,
    }),
  ).toEqual({ kind: malformed ? "repair-required" : "accepted" })
  return prepared
}
it("releases only unissued out-of-range batches after root acceptance and never refunds prior attempts", () => {
  // Given the pre-consent seven-job/fourteen-attempt envelope and two issued map/root calls.
  const f = given()
  try {
    acceptNext(f)
    const root = acceptNext(f)
    expect(() =>
      f.storage.fullBookExecution.accept({
        lease: root.lease,
        attemptId: root.attempt.id,
        now: clock.now,
      }),
    ).toThrow()
    // When the accepted root has only three findings, then two unused jobs release four held slots once.
    expect(
      f.storage.fullBookConsent.commitments(
        f.consent.ownerId,
        f.consent.session.input.normalization.editionHash,
      ),
    ).toEqual({ spent: 2, held: 8 })
    for (let index = 0; index < 3; index++) acceptNext(f)
    expect(
      f.storage.fullBookExecution.claim({
        consentId: f.consent.id,
        token: randomUUID(),
        now: clock.now,
        expiresAt: clock.expiresAt,
      }),
    ).toBeNull()
    expect(f.storage.fullBookExecution.attempts(f.consent.id)).toHaveLength(5)
    expect(f.storage.fullBookExecution.receipts(f.consent.id)).toHaveLength(7)
    expect(
      f.storage.fullBookConsent.commitments(
        f.consent.ownerId,
        f.consent.session.input.normalization.editionHash,
      ),
    ).toEqual({ spent: 5, held: 0 })
    expect(f.consent.session.plan.maxAttempts).toBe(14)
  } finally {
    f.cleanup()
  }
})
it("retains a prior repair charge while unused holds are released", () => {
  // Given an issued root schema repair under the same original fourteen-attempt maximum.
  const f = given()
  try {
    acceptNext(f)
    acceptNext(f, true)
    acceptNext(f)
    // When root acceptance vacates two batches, then all three prior attempts remain counted.
    expect(
      f.storage.fullBookConsent.commitments(
        f.consent.ownerId,
        f.consent.session.input.normalization.editionHash,
      ),
    ).toEqual({ spent: 3, held: 7 })
    for (let index = 0; index < 3; index++) acceptNext(f)
    expect(f.storage.fullBookExecution.attempts(f.consent.id)).toHaveLength(6)
    expect(
      f.storage.fullBookConsent.commitments(
        f.consent.ownerId,
        f.consent.session.input.normalization.editionHash,
      ),
    ).toEqual({ spent: 6, held: 0 })
  } finally {
    f.cleanup()
  }
})
it("ports not-needed evidence as immutable historical audit while retaining actual charges", () => {
  // Given a completed version-two scope with five actual calls and two unused proof records.
  const f = given(),
    destination = portableDestination()
  try {
    for (let index = 0; index < 5; index++) acceptNext(f)
    // When the existing archive round trip runs, then local proof survives without becoming new authority.
    const bytes = captureLibrary(f.options),
      archive = Archive.parse(JSON.parse(bytes.toString("utf8")))
    const row = archive.payload.tables.find((table) => table.name === "full_book_imports")?.rows[0]
    const auditBlob = archive.payload.blobs.find((blob) => blob.hash === row?.["id"])
    if (!auditBlob) throw new TypeError("Missing audit fixture blob")
    expect(
      z
        .object({ notNeeded: z.array(z.unknown()).length(2) })
        .parse(JSON.parse(Buffer.from(auditBlob.bytes, "base64").toString("utf8"))).notNeeded,
    ).toHaveLength(2)
    restoreLibrary(destination.options, bytes)
    const restored = openStorage(destination.options)
    try {
      expect(
        restored.fullBookConsent.commitments(
          destination.owner,
          f.consent.session.input.normalization.editionHash,
        ),
      ).toEqual({ spent: 5, held: 0 })
    } finally {
      restored.close()
    }
  } finally {
    f.cleanup()
    destination.cleanup()
  }
})
it("retains immutable root-bound not-needed proof and refuses replayed or foreign evidence", () => {
  // Given accepted immutable root evidence and automatically vacated future batches.
  const f = given()
  try {
    acceptNext(f)
    acceptNext(f)
    const db = new FixtureDatabase(f.options.databasePath)
    try {
      const row = db.prepare("SELECT * FROM full_book_not_needed LIMIT 1").get()
      expect(row).toBeDefined()
      // When/Then raw mutation or duplicate insertion cannot release the same allowance again.
      expect(() =>
        db.prepare("UPDATE full_book_not_needed SET root_hash=?").run("f".repeat(64)),
      ).toThrow()
      expect(() =>
        db.prepare("INSERT INTO full_book_not_needed SELECT * FROM full_book_not_needed").run(),
      ).toThrow()
      expect(() =>
        db
          .prepare(
            "UPDATE full_book_jobs SET state='queued' WHERE id IN (SELECT job_id FROM full_book_not_needed)",
          )
          .run(),
      ).toThrow("vacated")
      expect(() =>
        db
          .prepare(
            "INSERT INTO external_attempts(id,run_id,input_revision_id,state,reservation,record_json) SELECT 'forbidden-unused-attempt',r.id,r.input_revision_id,'prepared',1,'{}' FROM generation_runs r JOIN full_book_jobs j ON j.run_id=r.id JOIN full_book_not_needed n ON n.job_id=j.id LIMIT 1",
          )
          .run(),
      ).toThrow()
    } finally {
      db.close()
    }
    const receipts = f.storage.fullBookExecution.receipts(f.consent.id)
    expect(fullBookTestNotNeeded(f.consent.session, receipts)).toBeNull()
  } finally {
    f.cleanup()
  }
})

it("refuses foreign-root release evidence before local root acceptance without releasing any holds", () => {
  // Given a foreign accepted root and a local scope with only its map call issued.
  const f = given(),
    foreign = given(11)
  try {
    acceptNext(f)
    acceptNext(foreign)
    acceptNext(foreign)
    const a = new FixtureDatabase(foreign.options.databasePath),
      b = new FixtureDatabase(f.options.databasePath)
    try {
      const row = z
        .object({ node_index: z.number(), root_hash: z.string(), record_json: z.string() })
        .parse(a.prepare("SELECT * FROM full_book_not_needed LIMIT 1").get())
      const job = z
        .object({ id: z.string() })
        .parse(
          b
            .prepare("SELECT id FROM full_book_jobs WHERE consent_id=? AND node_index=?")
            .get(f.consent.id, row.node_index),
        )
      // When/Then a foreign root cannot authorize a local batch release, even through the raw admission boundary.
      expect(() =>
        b
          .prepare("INSERT INTO full_book_not_needed VALUES (?,?,?,?,2,?)")
          .run(f.consent.id, row.node_index, job.id, row.root_hash, row.record_json),
      ).toThrow("accepted exact root")
    } finally {
      a.close()
      b.close()
    }
    expect(
      f.storage.fullBookConsent.commitments(
        f.consent.ownerId,
        f.consent.session.input.normalization.editionHash,
      ),
    ).toEqual({ spent: 1, held: 13 })
  } finally {
    f.cleanup()
    foreign.cleanup()
  }
})
