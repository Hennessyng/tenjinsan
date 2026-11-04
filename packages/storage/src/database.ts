import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import Database from "better-sqlite3"
import { type BetterSQLite3Database, drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { installAnalysisPurposeMutationGuards } from "./analysis-purpose-mutations.ts"
import { TABLES } from "./backup-tables.ts"
import { LiveStudyGuard } from "./live-study-guard.ts"
import * as schema from "./schema/index.ts"

export type StorageDatabase = BetterSQLite3Database<typeof schema>

export type StorageContext = {
  readonly sqlite: Database.Database
  readonly db: StorageDatabase
  readonly liveStudyGuard: LiveStudyGuard
}

export type StorageDiagnostics = {
  readonly foreignKeys: boolean
  readonly recursiveTriggers: boolean
  readonly journalMode: "wal"
  readonly busyTimeoutMs: 5000
}

export function openDatabase(databasePath: string, liveStudyTarget?: unknown): StorageContext {
  mkdirSync(dirname(databasePath), { recursive: true })
  const sqlite = new Database(databasePath)
  sqlite.pragma("foreign_keys = ON")
  sqlite.pragma("recursive_triggers = ON")
  sqlite.pragma("journal_mode = WAL")
  sqlite.pragma("busy_timeout = 5000")
  const db = drizzle({ client: sqlite, schema })
  const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url))
  try {
    migrate(db, { migrationsFolder })
    installAnalysisPurposeMutationGuards(sqlite)
    for (const table of [
      "owners",
      "installations",
      "backup_history",
      "auth_sessions",
      "subscription_connections",
      "subscription_sessions",
      "live_study_guards",
      "live_study_budgets",
      "live_study_budget_members",
      "live_study_budget_approvals",
      "live_study_retirements",
      "full_book_consents",
      "full_book_consent_closures",
      "full_book_jobs",
      "full_book_wires",
      "full_book_output_receipts",
      "full_book_attempt_events",
      "full_book_reply_metadata",
      "full_book_managed_consents",
      "full_book_managed_revocations",
      "full_book_managed_frames",
      "full_book_managed_threads",
      "full_book_managed_failures",
      "full_book_recoveries",
      "full_book_recovery_uses",
      ...TABLES.map((entry) => entry.name),
    ]) {
      for (const action of ["INSERT", "UPDATE", "DELETE"] as const) {
        sqlite.exec(`CREATE TRIGGER IF NOT EXISTS maintenance_${table}_${action.toLowerCase()}
          BEFORE ${action} ON ${table}
          WHEN (SELECT phase FROM maintenance_gate WHERE id = 1) = 'frozen'
          BEGIN SELECT RAISE(ABORT, 'library maintenance frozen'); END`)
      }
    }
    return { sqlite, db, liveStudyGuard: new LiveStudyGuard({ sqlite }, liveStudyTarget) }
  } catch (error) {
    sqlite.close()
    throw error
  }
}

export function databaseDiagnostics(sqlite: Database.Database): StorageDiagnostics {
  const foreignKeys: unknown = sqlite.pragma("foreign_keys", { simple: true })
  const recursiveTriggers: unknown = sqlite.pragma("recursive_triggers", { simple: true })
  const journalMode: unknown = sqlite.pragma("journal_mode", { simple: true })
  const busyTimeout: unknown = sqlite.pragma("busy_timeout", { simple: true })
  const foreignKeyViolations: unknown = sqlite.pragma("foreign_key_check")
  if (
    foreignKeys !== 1 ||
    recursiveTriggers !== 1 ||
    journalMode !== "wal" ||
    busyTimeout !== 5000 ||
    !Array.isArray(foreignKeyViolations) ||
    foreignKeyViolations.length !== 0
  ) {
    throw new TypeError("SQLite safety pragmas are not active")
  }
  return { foreignKeys: true, recursiveTriggers: true, journalMode: "wal", busyTimeoutMs: 5000 }
}
