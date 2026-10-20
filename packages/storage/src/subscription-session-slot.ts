import { createHash } from "node:crypto"
import { mkdirSync, readdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import type { LocalSubscriptionProvider } from "@reading-studio/contracts"
import Database from "better-sqlite3"
import { z } from "zod"
import { SubscriptionLoginError } from "./subscription-session-store.ts"

export class SubscriptionSessionSlot {
  constructor(
    private readonly root: string,
    private readonly provider: LocalSubscriptionProvider,
  ) {}
  directory(installation: string): string {
    const path = join(
      this.root,
      "subscription-connections",
      createHash("sha256")
        .update(
          {
            "chatgpt-subscription": installation,
            "grok-subscription": JSON.stringify([installation, this.provider]),
          }[this.provider],
        )
        .digest("hex"),
    )
    mkdirSync(path, { recursive: true, mode: 0o700 })
    return path
  }
  lock(installation: string): Database.Database {
    const lock = new Database(join(this.directory(installation), "session-lock.sqlite"), {
      timeout: 0,
    })
    try {
      lock.exec("BEGIN EXCLUSIVE")
      const processLock = new Database(
        join(this.directory(installation), "session-process-lock.sqlite"),
        { timeout: 0 },
      )
      try {
        processLock.exec("BEGIN EXCLUSIVE")
      } finally {
        processLock.close()
      }
      return lock
    } catch (error) {
      lock.close()
      if (z.object({ code: z.literal("SQLITE_BUSY") }).safeParse(error).success)
        throw new SubscriptionLoginError("connection-busy")
      throw error
    }
  }
  cleanup(installation: string, keep: string | null): void {
    const directory = this.directory(installation)
    for (const name of readdirSync(directory))
      if (z.uuid().safeParse(name).success && name !== keep)
        rmSync(join(directory, name), { recursive: true, force: true })
  }
}
