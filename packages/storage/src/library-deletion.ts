import { unlinkSync } from "node:fs"
import { EditionId, StudyId } from "@reading-studio/contracts"
import type Database from "better-sqlite3"
import { z } from "zod"
import { type LibraryPaths, openMaintenanceDatabase } from "./backup.ts"
import { referencedHashes } from "./backup-records.ts"
import { BackupError, History, Row, TABLES } from "./backup-schema.ts"
import { PrivateBlobStore } from "./blob-store.ts"
import { withMaintenance } from "./maintenance.ts"

const Target = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("source"), id: EditionId }),
  z.strictObject({ kind: z.literal("project"), id: StudyId }),
])
const ForeignKey = z.object({
  id: z.number(),
  seq: z.number(),
  table: z.string(),
  from: z.string(),
  to: z.string(),
})
const domainTables = [...TABLES.map((table) => table.name), "backup_history"]

function storedHashes(sqlite: Database.Database): ReadonlySet<string> {
  const tables = TABLES.filter((table) => table.record).map((table) => ({
    name: table.name,
    rows: sqlite
      .prepare(`SELECT record_json FROM ${table.name}`)
      .all()
      .map((row) => Row.parse(row)),
  }))
  const history = sqlite
    .prepare("SELECT record_json FROM backup_history")
    .all()
    .map((row) =>
      History.parse(JSON.parse(z.object({ record_json: z.string() }).parse(row).record_json)),
    )
  return referencedHashes({ tables, history })
}

function collectDescendants(sqlite: Database.Database): void {
  const relations = domainTables.flatMap((table) => {
    const keys = sqlite
      .prepare(`PRAGMA foreign_key_list(${table})`)
      .all()
      .map((row) => ForeignKey.parse(row))
    const ids = [...new Set(keys.map((key) => key.id))]
    return ids.flatMap((id) => {
      const group = keys.filter((key) => key.id === id)
      const parent = group[0]?.table
      if (!parent || !domainTables.includes(parent)) return []
      const join = group.map((key) => `c."${key.from}" = p."${key.to}"`).join(" AND ")
      return [
        sqlite.prepare(`INSERT OR IGNORE INTO deletion_rows (table_name, row_id)
        SELECT '${table}', c.rowid FROM ${table} c JOIN ${parent} p ON ${join}
        JOIN deletion_rows d ON d.table_name = '${parent}' AND d.row_id = p.rowid`),
      ]
    })
  })
  let changed = true
  while (changed) {
    changed = false
    for (const statement of relations) if (statement.run().changes > 0) changed = true
  }
}

export function deleteLibraryItem(paths: LibraryPaths, input: unknown) {
  const target = Target.parse(input)
  const sqlite = openMaintenanceDatabase(paths.databasePath)
  const blobs = new PrivateBlobStore(paths.privateDataRoot)
  let orphaned: readonly string[] = []
  let sharedBlobs: readonly string[] = []
  let deletedRows = 0
  try {
    return withMaintenance(sqlite, () => {
      sqlite.pragma("foreign_keys = OFF")
      sqlite
        .transaction(() => {
          const before = storedHashes(sqlite)
          sqlite.exec(
            "CREATE TEMP TABLE deletion_rows (table_name TEXT, row_id INTEGER, PRIMARY KEY(table_name, row_id))",
          )
          const table = target.kind === "source" ? "book_editions" : "studies"
          const selected = sqlite
            .prepare(`INSERT INTO deletion_rows SELECT ?, rowid FROM ${table} WHERE id = ?`)
            .run(table, target.id)
          if (selected.changes !== 1) throw new BackupError("deletion target not found")
          collectDescendants(sqlite)
          sqlite.exec(`INSERT OR IGNORE INTO deletion_rows (table_name, row_id)
        SELECT 'privacy_reviews', r.rowid FROM privacy_reviews r
        WHERE EXISTS (SELECT 1 FROM publication_revisions p JOIN deletion_rows d
          ON d.table_name = 'publication_revisions' AND d.row_id = p.rowid WHERE p.privacy_review_id = r.id)
        AND NOT EXISTS (SELECT 1 FROM publication_revisions p WHERE p.privacy_review_id = r.id
          AND p.rowid NOT IN (SELECT row_id FROM deletion_rows WHERE table_name = 'publication_revisions'))`)
          const triggers = sqlite
            .prepare("SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'trigger'")
            .all()
            .map((row) =>
              z.object({ name: z.string(), tbl_name: z.string(), sql: z.string() }).parse(row),
            )
            .filter(
              (trigger) =>
                domainTables.includes(trigger.tbl_name) && /BEFORE DELETE/i.test(trigger.sql),
            )
          for (const trigger of triggers) sqlite.exec(`DROP TRIGGER "${trigger.name}"`)
          for (const tableName of domainTables) {
            deletedRows += sqlite
              .prepare(`DELETE FROM ${tableName} WHERE rowid IN
          (SELECT row_id FROM deletion_rows WHERE table_name = ?)`)
              .run(tableName).changes
          }
          for (const trigger of triggers) sqlite.exec(trigger.sql)
          if (sqlite.prepare("PRAGMA foreign_key_check").all().length)
            throw new BackupError("deletion would break domain references")
          const remaining = storedHashes(sqlite)
          orphaned = [...before].filter((hash) => !remaining.has(hash))
          sharedBlobs = [...before].filter((hash) => remaining.has(hash))
        })
        .exclusive()
      const retainedBlobs: string[] = []
      for (const hash of orphaned) {
        try {
          unlinkSync(blobs.pathFor(hash))
        } catch (error) {
          if (error instanceof Error) retainedBlobs.push(hash)
          else throw error
        }
      }
      return {
        deletedRows,
        sharedBlobs,
        retainedBlobs,
        erasure:
          "Logical deletion only; not secure erasure. SQLite/WAL pages, snapshots, backups and storage media may retain copies.",
      }
    })
  } finally {
    sqlite.close()
  }
}
