import { randomUUID } from "node:crypto"
import type Database from "better-sqlite3"
import { StoredRecordError } from "./errors.ts"

export function ensureLibraryOwner(sqlite: Database.Database): string {
  return sqlite
    .transaction(() => {
      const owners = sqlite
        .prepare<[], { readonly id: string }>("SELECT id FROM owners LIMIT 2")
        .all()
      if (owners.length > 1) throw new StoredRecordError("library owner", "owners")
      const existing = owners[0]
      if (existing) return existing.id
      const users = sqlite
        .prepare<[], { readonly id: string }>("SELECT id FROM auth_users LIMIT 2")
        .all()
      if (users.length > 1) throw new StoredRecordError("legacy library owner", "auth_users")
      const id = users[0]?.id ?? randomUUID()
      sqlite.prepare("INSERT INTO owners (id) VALUES (?)").run(id)
      return id
    })
    .immediate()
}
