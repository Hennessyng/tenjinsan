import type Database from "better-sqlite3"
import { and, eq } from "drizzle-orm"
import type { StorageDatabase } from "./database.ts"
import { openDatabase } from "./database.ts"
import {
  holdMaintenanceProcess,
  registerMaintenanceInstance,
  releaseMaintenanceInstance,
} from "./maintenance-process-lock.ts"
import { authAccounts, authSessions, authUsers, owners } from "./schema/index.ts"

type ProvisionedOwner = {
  readonly email: string
  readonly id: string
}

export class AuthStorage {
  readonly database: StorageDatabase
  readonly sqlite: Database.Database
  private readonly processLock: Database.Database
  private readonly instanceId: string

  constructor(databasePath: string) {
    this.processLock = holdMaintenanceProcess(databasePath)
    let context: ReturnType<typeof openDatabase> | undefined
    try {
      context = openDatabase(databasePath)
      this.instanceId = registerMaintenanceInstance(context.sqlite, "auth")
      this.database = context.db
      this.sqlite = context.sqlite
    } catch (error) {
      try {
        context?.sqlite.close()
      } finally {
        this.processLock.close()
      }
      throw error
    }
  }

  close(): void {
    if (!this.sqlite.open) return
    try {
      releaseMaintenanceInstance(this.sqlite, this.instanceId)
    } finally {
      try {
        this.sqlite.close()
      } finally {
        this.processLock.close()
      }
    }
  }

  ownerCount(): number {
    return this.countRows("owners")
  }

  authUserCount(): number {
    return this.countRows("auth_users")
  }

  provisionedOwner(): ProvisionedOwner | null {
    const records = this.database
      .select({ email: authUsers.email, id: authUsers.id })
      .from(authUsers)
      .innerJoin(owners, eq(owners.id, authUsers.id))
      .innerJoin(
        authAccounts,
        and(eq(authAccounts.userId, authUsers.id), eq(authAccounts.providerId, "credential")),
      )
      .limit(2)
      .all()
    return records.length === 1 ? (records[0] ?? null) : null
  }

  resetCredential(ownerId: string, passwordHash: string): void {
    this.sqlite.transaction(() => {
      const result = this.database
        .update(authAccounts)
        .set({ password: passwordHash, updatedAt: new Date() })
        .where(and(eq(authAccounts.userId, ownerId), eq(authAccounts.providerId, "credential")))
        .run()
      if (result.changes !== 1) {
        throw new OwnerCredentialMissingError()
      }
      this.database.delete(authSessions).where(eq(authSessions.userId, ownerId)).run()
    })()
  }

  private countRows(tableName: "auth_users" | "owners"): number {
    const row = this.sqlite
      .prepare<[], { readonly count: number }>(`SELECT count(*) AS count FROM ${tableName}`)
      .get()
    if (row === undefined) {
      throw new AuthStorageReadError(tableName)
    }
    return row.count
  }
}

export class AuthStorageReadError extends Error {
  override readonly name = "AuthStorageReadError"

  constructor(readonly tableName: string) {
    super(`Unable to read authentication storage table: ${tableName}`)
  }
}

export class OwnerCredentialMissingError extends Error {
  override readonly name = "OwnerCredentialMissingError"

  constructor() {
    super("The provisioned owner has no password credential")
  }
}

export function openAuthStorage(databasePath: string): AuthStorage {
  return new AuthStorage(databasePath)
}
