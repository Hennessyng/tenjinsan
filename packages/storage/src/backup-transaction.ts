import { ExternalAttempt, Job, TransmissionGrant } from "@reading-studio/contracts"
import type Database from "better-sqlite3"
import { z } from "zod"
import {
  BackupError,
  columns,
  INSTALLATION_HANDLE,
  type Payload,
  type Row,
  TABLES,
  tableNamed,
} from "./backup-schema.ts"

export type DestinationIdentity = {
  readonly owner: string
  readonly installation: string
  readonly validateHistory?: boolean
}

export function assertEmpty(sqlite: Database.Database): void {
  for (const table of [...TABLES.map((item) => item.name), "backup_history"]) {
    if (sqlite.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get())
      throw new BackupError("destination domain library must be empty")
  }
}

function remap(row: Row, table: string, identity: DestinationIdentity): Row {
  if (table === "studies") return { ...row, owner_id: identity.owner }
  if (table === "transmission_grants") {
    const grant = TransmissionGrant.parse(JSON.parse(z.string().parse(row["record_json"])))
    return {
      ...row,
      owner_id: identity.owner,
      installation_id: identity.installation,
      record_json: JSON.stringify({
        ...grant,
        ownerId: identity.owner,
        installationId: identity.installation,
      }),
    }
  }
  if (table === "jobs") {
    const job = Job.parse(JSON.parse(z.string().parse(row["record_json"])))
    return {
      ...row,
      record_json: JSON.stringify({
        ...job,
        grant: { ...job.grant, ownerId: identity.owner, installationId: identity.installation },
      }),
    }
  }
  return row
}

export function insertPayload(
  sqlite: Database.Database,
  payload: Payload,
  identity: DestinationIdentity,
): void {
  // Approval gates protect new work, not import of inert historical descendants.
  // Their removal and recreation are inside the same exclusive transaction.
  const gates = [
    "outline_jobs_require_brief",
    "outline_requires_current_brief",
    "lesson_requires_current_brief",
    "publication_requires_current_brief",
    "artifact_requires_current_brief",
    "evidence_requires_current_brief",
    "lesson_requires_current_outline",
    "section_jobs_require_outline",
  ]
  const triggers = gates.map((name) =>
    z
      .object({ name: z.string(), sql: z.string() })
      .parse(
        sqlite
          .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND name = ?")
          .get(name),
      ),
  )
  for (const trigger of triggers) sqlite.exec(`DROP TRIGGER "${trigger.name}"`)
  sqlite.pragma("defer_foreign_keys = ON")
  sqlite
    .prepare("INSERT INTO installations (id, owner_id) VALUES (?, ?)")
    .run(identity.installation, identity.owner)
  for (const entry of payload.tables) {
    const table = tableNamed(entry.name)
    const fields = columns(table)
    const insert = sqlite.prepare(
      `INSERT INTO ${table.name} (${fields.join(",")}) VALUES (${fields.map(() => "?").join(",")})`,
    )
    const rows = identity.validateHistory
      ? [
          ...entry.rows,
          ...payload.history.filter((item) => item.table === table.name).map((item) => item.row),
        ]
      : entry.rows
    for (const input of rows) {
      const row = remap(input, table.name, identity)
      insert.run(
        ...fields.map((field) => {
          const value = row[field]
          if (value === undefined) throw new BackupError("missing required column")
          return value
        }),
      )
      if (table.name === "external_attempts") {
        const attempt = ExternalAttempt.parse(JSON.parse(z.string().parse(row["record_json"])))
        if (attempt.state === "response-received") {
          const blob = payload.blobs.find((item) => item.hash === attempt.responseHash)
          if (!blob) throw new BackupError("missing attempt response blob")
          sqlite
            .prepare("UPDATE external_attempts SET response_body = ? WHERE id = ?")
            .run(Buffer.from(blob.bytes, "base64"), attempt.id)
        }
      }
    }
  }
  const addHistory = sqlite.prepare(
    "INSERT INTO backup_history (study_id, edition_id, record_json) VALUES (?, ?, ?)",
  )
  for (const history of payload.history)
    addHistory.run(history.studyId, history.editionId, JSON.stringify(history))
  for (const trigger of triggers) sqlite.exec(trigger.sql)
  if (sqlite.prepare("PRAGMA foreign_key_check").all().length)
    throw new BackupError("foreign key validation failed")
  const mismatchedGrant = sqlite
    .prepare(`SELECT j.id FROM jobs j JOIN transmission_grants g ON g.id = j.grant_id
    WHERE json_extract(j.record_json, '$.grant') != json(g.record_json) LIMIT 1`)
    .get()
  if (mismatchedGrant) throw new BackupError("job historical grant mismatch")
}

export const stagingIdentity: DestinationIdentity = {
  owner: "historical-owner",
  installation: INSTALLATION_HANDLE,
  validateHistory: true,
}
