import { randomUUID } from "node:crypto"
import { mkdirSync, realpathSync } from "node:fs"
import { dirname, resolve } from "node:path"
import Database from "better-sqlite3"
import { z } from "zod"
import { BackupError } from "./backup-schema.ts"

function lockPath(databasePath: string, kind: "maintenance-lock" | "maintenance-operator"): string {
  return `${realpathSync(databasePath)}.${kind}.sqlite`
}

function requireRollbackLock(lock: Database.Database): void {
  const mode: unknown = lock.pragma("journal_mode", { simple: true })
  if (mode !== "delete")
    throw new BackupError("recovery refused: process lock is not a rollback-journal database")
}

function holdSharedLock(path: string): Database.Database {
  const lock = new Database(path, { timeout: 5_000 })
  try {
    requireRollbackLock(lock)
    lock.exec("CREATE TABLE IF NOT EXISTS instance_lock (id INTEGER PRIMARY KEY)")
    lock.exec("BEGIN")
    lock.prepare("SELECT COUNT(*) FROM instance_lock").get()
    return lock
  } catch (error) {
    lock.close()
    throw error
  }
}

export function holdMaintenanceProcess(databasePath: string): Database.Database {
  mkdirSync(dirname(resolve(databasePath)), { recursive: true })
  new Database(databasePath).close()
  return holdSharedLock(lockPath(databasePath, "maintenance-lock"))
}

export function holdMaintenanceOperator(databasePath: string): Database.Database {
  return holdSharedLock(lockPath(databasePath, "maintenance-operator"))
}

export function maintenanceHolderState(databasePath: string): "active" | "dead" | "unverified" {
  let lock: Database.Database
  try {
    lock = new Database(lockPath(databasePath, "maintenance-operator"), {
      fileMustExist: true,
      timeout: 100,
    })
  } catch (error) {
    if (error instanceof Error) return "unverified"
    throw error
  }
  try {
    requireRollbackLock(lock)
    try {
      lock.exec("BEGIN EXCLUSIVE")
      return "dead"
    } catch (error) {
      if (z.object({ code: z.literal("SQLITE_BUSY") }).safeParse(error).success) return "active"
      throw error
    }
  } finally {
    lock.close()
  }
}

export type MaintenanceInstanceRole = "api" | "worker" | "auth" | "storage" | "operator"

export function registerMaintenanceInstance(
  sqlite: Database.Database,
  role: MaintenanceInstanceRole,
): string {
  const id = randomUUID()
  sqlite.prepare("INSERT INTO maintenance_instances (id, role) VALUES (?, ?)").run(id, role)
  return id
}

export function releaseMaintenanceInstance(sqlite: Database.Database, id: string): void {
  sqlite.prepare("DELETE FROM maintenance_instances WHERE id = ?").run(id)
}

export function recoverWithQuiescence<T>(databasePath: string, operation: () => T): T {
  let lock: Database.Database
  try {
    lock = new Database(lockPath(databasePath, "maintenance-lock"), {
      fileMustExist: true,
      timeout: 100,
    })
  } catch (error) {
    if (error instanceof Error) {
      throw new BackupError("recovery refused: shared process lock missing or inaccessible")
    }
    throw error
  }
  try {
    requireRollbackLock(lock)
    try {
      lock.exec("BEGIN EXCLUSIVE")
    } catch (error) {
      if (z.object({ code: z.literal("SQLITE_BUSY") }).safeParse(error).success)
        throw new BackupError(
          "recovery refused: active API, worker, or maintenance process; stop all writers first",
        )
      throw error
    }
    return operation()
  } finally {
    lock.close()
  }
}
