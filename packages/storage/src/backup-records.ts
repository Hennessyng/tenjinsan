import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { Digest } from "@reading-studio/contracts"
import type Database from "better-sqlite3"
import { z } from "zod"
import { safeRecord } from "./backup-sanitize.ts"
import {
  BackupError,
  columns,
  History,
  OWNER_HANDLE,
  type Payload,
  parseRow,
  type Row,
  TABLES,
  tableNamed,
} from "./backup-schema.ts"
import type { PrivateBlobStore } from "./blob-store.ts"

export function digest(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

export function referencedHashes(
  payload: Pick<Payload, "tables" | "history">,
): ReadonlySet<string> {
  const hashes = new Set<string>()
  function visit(value: z.infer<ReturnType<typeof z.json>>, key = ""): void {
    if (
      typeof value === "string" &&
      ["originalBlobHash", "contentHash", "responseHash"].includes(key)
    )
      hashes.add(value)
    else if (Array.isArray(value)) {
      for (const item of value) visit(item, key === "embeddedAssetHashes" ? "contentHash" : "")
    } else if (value !== null && typeof value === "object") {
      for (const [field, item] of Object.entries(value)) visit(item, field)
    }
  }
  for (const row of [
    ...payload.tables.flatMap((table) => table.rows),
    ...payload.history.map((item) => item.row),
  ]) {
    if (typeof row["record_json"] === "string")
      visit(z.json().parse(JSON.parse(row["record_json"])))
  }
  return hashes
}

function historyScope(sqlite: Database.Database, row: Row, tableName: string) {
  let studyId = typeof row["study_id"] === "string" ? row["study_id"] : null
  const links = [
    ["setup_revision_id", "setup_revisions"],
    ["lesson_revision_id", "lesson_revisions"],
    ["brief_revision_id", "brief_revisions"],
    ["outline_revision_id", "outline_revisions"],
  ] as const
  for (const [column, table] of links) {
    if (!studyId && typeof row[column] === "string") {
      const parent = sqlite.prepare(`SELECT study_id FROM ${table} WHERE id = ?`).get(row[column])
      if (parent) studyId = z.object({ study_id: z.string() }).parse(parent).study_id
    }
  }
  const publicationId = row["publication_id"] ?? row["publication_revision_id"]
  if (!studyId && typeof publicationId === "string") {
    const parent = sqlite
      .prepare(`SELECT l.study_id FROM publication_revisions p
      JOIN lesson_revisions l ON l.id = p.lesson_revision_id WHERE p.id = ?`)
      .get(publicationId)
    if (parent) studyId = z.object({ study_id: z.string() }).parse(parent).study_id
  }
  if (!studyId && tableName === "privacy_reviews") {
    const parent = sqlite
      .prepare(`SELECT l.study_id FROM publication_revisions p
      JOIN lesson_revisions l ON l.id = p.lesson_revision_id WHERE p.privacy_review_id = ? LIMIT 1`)
      .get(row["id"])
    if (parent) studyId = z.object({ study_id: z.string() }).parse(parent).study_id
  }
  const study = studyId
    ? sqlite.prepare("SELECT edition_id FROM studies WHERE id = ?").get(studyId)
    : null
  const editionId = study ? z.object({ edition_id: z.string() }).parse(study).edition_id : null
  return { studyId, editionId }
}

export function snapshot(sqlite: Database.Database, blobs: PrivateBlobStore): Payload {
  const history = sqlite
    .prepare("SELECT record_json FROM backup_history ORDER BY sequence")
    .all()
    .map((row) =>
      History.parse(JSON.parse(z.object({ record_json: z.string() }).parse(row).record_json)),
    )
  const tables = TABLES.map((table) => {
    const rows = sqlite
      .prepare(`SELECT ${columns(table).join(",")} FROM ${table.name} ORDER BY rowid`)
      .all()
      .map((row) => safeRecord(table.name, parseRow(table, row)))
    if (table.historical) {
      history.push(
        ...rows.map((row) =>
          History.parse({
            table: table.name,
            row,
            ownerHandle: OWNER_HANDLE,
            ...historyScope(sqlite, row, table.name),
          }),
        ),
      )
      return { name: table.name, rows: [] }
    }
    return { name: table.name, rows }
  })
  const inline = new Map<string, Buffer>()
  for (const table of ["publication_outputs", "external_attempts"]) {
    const column = table === "publication_outputs" ? "bytes" : "response_body"
    for (const raw of sqlite
      .prepare(`SELECT ${column} AS bytes FROM ${table} WHERE ${column} IS NOT NULL`)
      .all()) {
      const bytes = z.object({ bytes: z.instanceof(Buffer) }).parse(raw).bytes
      inline.set(digest(bytes), bytes)
    }
  }
  const entries = [...referencedHashes({ tables, history })].sort().map((hash) => {
    const bytes = inline.get(hash) ?? readFileSync(blobs.pathFor(hash))
    if (digest(bytes) !== hash) throw new BackupError("referenced blob digest mismatch")
    return { hash: Digest.parse(hash), bytes: bytes.toString("base64") }
  })
  return {
    version: 1,
    schemaVersion: 10,
    ownerHandle: OWNER_HANDLE,
    tables,
    history,
    blobs: entries,
  }
}

export function validatePayload(payload: Payload): void {
  if (
    payload.tables.length !== TABLES.length ||
    new Set(payload.tables.map((table) => table.name)).size !== TABLES.length
  )
    throw new BackupError("incomplete or duplicate table manifest")
  for (const entry of payload.tables) {
    const table = tableNamed(entry.name)
    if (table.historical && entry.rows.length)
      throw new BackupError("historical authority cannot be restored live")
    for (const row of entry.rows) {
      parseRow(table, row)
      if (JSON.stringify(safeRecord(table.name, row)) !== JSON.stringify(row))
        throw new BackupError("archive contains identity, authority, or runnable work")
    }
  }
  for (const entry of payload.history) {
    const table = tableNamed(entry.table)
    if (!table.historical) throw new BackupError("invalid historical table")
    parseRow(table, entry.row)
    if (JSON.stringify(safeRecord(table.name, entry.row)) !== JSON.stringify(entry.row))
      throw new BackupError("historical record contains live authority")
  }
  const required = referencedHashes(payload)
  if (
    payload.blobs.length !== required.size ||
    new Set(payload.blobs.map((blob) => blob.hash)).size !== required.size
  )
    throw new BackupError("blob manifest does not match references")
  for (const blob of payload.blobs) {
    if (!required.has(blob.hash) || digest(Buffer.from(blob.bytes, "base64")) !== blob.hash)
      throw new BackupError("blob hash mismatch")
  }
}
