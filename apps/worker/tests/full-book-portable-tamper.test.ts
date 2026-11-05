import { contentDigest, GenerationRun, NormalizationRevision } from "@reading-studio/contracts"
import { captureLibrary, openStorage } from "@reading-studio/storage"
import {
  Archive,
  FullBookAudit,
  FullBookImport,
  restoreLibrary,
} from "@reading-studio/storage/test-support"
import { expect, it } from "vitest"
import { z } from "zod"
import { portableDestination, portableFixture } from "./full-book-portable-fixture.ts"

function damage(archive: ReturnType<typeof Archive.parse>, kind: string) {
  const imports = archive.payload.tables.find((table) => table.name === "full_book_imports")
  const row = imports?.rows[0]
  if (!imports || !row) throw new TypeError("Missing import fixture")
  const meta = FullBookImport.parse(JSON.parse(z.string().parse(row["record_json"])))
  const blob = archive.payload.blobs.find((blob) => blob.hash === meta.auditBlobHash)
  if (!blob) throw new TypeError("Missing audit fixture")
  switch (kind) {
    case "missing-index":
    case "downgrade":
      imports.rows = []
      archive.payload.blobs = archive.payload.blobs.filter(
        (item) => item.hash !== meta.auditBlobHash,
      )
      if (kind === "downgrade") {
        archive.payload.schemaVersion = 11
        archive.payload.tables = archive.payload.tables.filter(
          (table) => table.name !== "full_book_imports",
        )
      }
      return
    case "duplicate-index":
      imports.rows.push(row)
      return
    case "owner":
      row["owner_id"] = "foreign-owner"
      return
    case "missing-blob":
      archive.payload.blobs = archive.payload.blobs.filter(
        (item) => item.hash !== meta.auditBlobHash,
      )
      return
    case "counter": {
      const run = archive.payload.tables
        .find((table) => table.name === "generation_runs")
        ?.rows.find((entry) => entry["id"] === meta.runIds[0])
      if (!run) throw new TypeError("Missing run fixture")
      run["reserved_calls"] = 0
      run["record_json"] = JSON.stringify({
        ...GenerationRun.parse(JSON.parse(z.string().parse(run["record_json"]))),
        reservedCalls: 0,
      })
      return
    }
    case "missing-attempt": {
      const attempts = archive.payload.tables.find((table) => table.name === "external_attempts")
      if (!attempts) throw new TypeError("Missing attempt fixture")
      attempts.rows = []
      return
    }
    case "source": {
      const source = archive.payload.tables.find(
        (table) => table.name === "normalization_revisions",
      )?.rows[0]
      if (!source) throw new TypeError("Missing source fixture")
      const normalized = NormalizationRevision.parse(
        JSON.parse(z.string().parse(source["record_json"])),
      )
      source["record_json"] = JSON.stringify({ ...normalized, omissions: [] })
      return
    }
    case "held":
      row["held"] = 1
      row["record_json"] = JSON.stringify({ ...meta, held: 1 })
      return
    case "version":
      row["budget_version"] = meta.budgetVersion + 1
      row["record_json"] = JSON.stringify({ ...meta, budgetVersion: meta.budgetVersion + 1 })
      return
    case "foreign-source":
      row["source_hash"] = contentDigest("foreign source")
      row["record_json"] = JSON.stringify({ ...meta, sourceHash: row["source_hash"] })
      return
  }
  const audit = FullBookAudit.parse(JSON.parse(Buffer.from(blob.bytes, "base64").toString("utf8")))
  switch (kind) {
    case "graph":
      audit.jobs.pop()
      break
    case "event":
      audit.events.pop()
      break
    case "receipt":
      audit.receipts.pop()
      break
    case "wire":
    case "reply": {
      const item = kind === "wire" ? audit.wires[0] : audit.replies[0]
      if (!item) throw new TypeError("Missing wire/reply fixture")
      const data = z
        .record(z.string(), z.json())
        .parse(JSON.parse(z.string().parse(item["record_json"])))
      item["record_json"] = JSON.stringify({
        ...data,
        [kind === "wire" ? "hash" : "wireHash"]: contentDigest("foreign wire"),
      })
      break
    }
    default:
      throw new TypeError("Unknown tamper fixture")
  }
  const bytes = Buffer.from(JSON.stringify(audit)),
    hash = contentDigest(bytes.toString("utf8"))
  blob.hash = hash
  blob.bytes = bytes.toString("base64")
  row["id"] = hash
  row["record_json"] = JSON.stringify({ ...meta, id: hash, auditBlobHash: hash })
}

it.each([
  "missing-index",
  "downgrade",
  "duplicate-index",
  "owner",
  "missing-blob",
  "counter",
  "missing-attempt",
  "source",
  "held",
  "version",
  "foreign-source",
  "graph",
  "event",
  "receipt",
  "wire",
  "reply",
])(
  "rejects a %s archive even with a recomputed outer digest, leaving destination empty",
  (kind) => {
    // Given a valid closed-source archive with deliberately forged declared history.
    const f = portableFixture(),
      destination = portableDestination()
    try {
      const archive = Archive.parse(JSON.parse(captureLibrary(f.options).toString("utf8")))
      damage(archive, kind)
      const bytes = Buffer.from(
        JSON.stringify({
          payload: archive.payload,
          digest: contentDigest(JSON.stringify(archive.payload)),
        }),
      )
      // When the existing restore pipeline validates the tampered archive.
      expect(() => restoreLibrary(destination.options, bytes)).toThrow()
      // Then no partial source, counter, capability or extra admission budget was committed.
      const restored = openStorage(destination.options)
      try {
        expect(restored.counts()).toMatchObject({
          editions: 0,
          studies: 0,
          runs: 0,
          attempts: 0,
          jobs: 0,
        })
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
  },
)
