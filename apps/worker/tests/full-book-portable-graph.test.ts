import {
  contentDigest,
  ExternalAttempt,
  FullBookAnalysisOutput,
  FullBookTestReceipt,
} from "@reading-studio/contracts"
import { captureLibrary, openStorage } from "@reading-studio/storage"
import {
  Archive,
  FullBookAudit,
  FullBookImport,
  restoreLibrary,
} from "@reading-studio/storage/test-support"
import { expect, it } from "vitest"
import { z } from "zod"
import { completedPortableFixture, portableDestination } from "./full-book-portable-fixture.ts"

it("ports a completed two-level reduction tree with all twenty-one charged stages and immutable original child identities", () => {
  // Given a complete four-window synthetic graph, not a blank-map capacity fixture.
  const f = completedPortableFixture(),
    destination = portableDestination()
  try {
    // When it is restored as historical-only audit through the existing pipeline.
    restoreLibrary(destination.options, captureLibrary(f.options))
    const restored = openStorage(destination.options)
    try {
      // Then all charges survive, old twenty-slot funding is exhausted and no original job is resumable.
      expect(
        restored.fullBookConsent.commitments(
          destination.owner,
          f.consent.session.input.normalization.editionHash,
        ),
      ).toEqual({ spent: 21, held: 0 })
      expect(
        restored.liveStudyBudget.analysisAllowance(
          destination.owner,
          f.consent.session.input.normalization.editionHash,
        ),
      ).toBe(0)
      expect(() => restored.fullBookExecution.receipts(f.consent.id)).toThrow()
      expect(
        Archive.parse(
          JSON.parse(captureLibrary(destination.options).toString("utf8")),
        ).payload.tables.find((table) => table.name === "external_attempts")?.rows,
      ).toHaveLength(21)
    } finally {
      restored.close()
    }
  } finally {
    destination.cleanup()
    f.cleanup()
  }
})

it("rejects a forged reduction child even when envelope, audit, reply-body and receipt hashes have all been recomputed", () => {
  // Given a complete original audit and a deliberately self-consistent hash forgery of a reduction output.
  const f = completedPortableFixture(),
    destination = portableDestination()
  try {
    const archive = Archive.parse(JSON.parse(captureLibrary(f.options).toString("utf8")))
    const row = archive.payload.tables.find((table) => table.name === "full_book_imports")?.rows[0]
    if (!row) throw new TypeError("Missing import fixture")
    const meta = FullBookImport.parse(JSON.parse(z.string().parse(row["record_json"])))
    const blob = archive.payload.blobs.find((blob) => blob.hash === meta.id)
    if (!blob) throw new TypeError("Missing audit fixture")
    const audit = FullBookAudit.parse(
      JSON.parse(Buffer.from(blob.bytes, "base64").toString("utf8")),
    )
    const receiptRow = audit.receipts[4]
    if (!receiptRow) throw new TypeError("Missing reduction fixture")
    const receipt = FullBookTestReceipt.parse(
      JSON.parse(z.string().parse(receiptRow["record_json"])),
    )
    const output = FullBookAnalysisOutput.parse(JSON.parse(receipt.serialized))
    const serialized = JSON.stringify({
      ...output,
      children: output.children.map((child, index) =>
        index === 0 ? { ...child, outputHash: contentDigest("foreign child") } : child,
      ),
    })
    const hash = contentDigest(serialized),
      attemptId = z.string().parse(receiptRow["attempt_id"])
    receiptRow["record_json"] = JSON.stringify({ serialized, outputHash: hash })
    for (const attempt of [
      ...audit.attempts,
      ...(archive.payload.tables.find((table) => table.name === "external_attempts")?.rows ?? []),
    ])
      if (attempt["id"] === attemptId)
        attempt["record_json"] = JSON.stringify({
          ...ExternalAttempt.parse(JSON.parse(z.string().parse(attempt["record_json"]))),
          responseHash: hash,
        })
    for (const event of audit.events)
      if (event["attempt_id"] === attemptId) {
        const record = ExternalAttempt.parse(JSON.parse(z.string().parse(event["record_json"])))
        if (record.state === "response-received")
          event["record_json"] = JSON.stringify({ ...record, responseHash: hash })
      }
    const response = archive.payload.blobs.find((blob) => blob.hash === receipt.outputHash)
    if (!response) throw new TypeError("Missing reply body fixture")
    response.hash = hash
    response.bytes = Buffer.from(serialized).toString("base64")
    blob.hash = contentDigest(JSON.stringify(audit))
    blob.bytes = Buffer.from(JSON.stringify(audit)).toString("base64")
    row["id"] = blob.hash
    row["record_json"] = JSON.stringify({ ...meta, id: blob.hash, auditBlobHash: blob.hash })
    // When the forged archive is validated before destination commit.
    expect(() =>
      restoreLibrary(
        destination.options,
        Buffer.from(
          JSON.stringify({
            payload: archive.payload,
            digest: contentDigest(JSON.stringify(archive.payload)),
          }),
        ),
      ),
    ).toThrow()
    // Then no source or charged history was partially admitted.
    const restored = openStorage(destination.options)
    try {
      expect(restored.counts()).toMatchObject({ editions: 0, attempts: 0 })
    } finally {
      restored.close()
    }
  } finally {
    destination.cleanup()
    f.cleanup()
  }
})
