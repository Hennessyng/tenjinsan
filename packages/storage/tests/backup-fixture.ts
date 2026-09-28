import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { openDatabase } from "../src/database.ts"
import { openStorage } from "../src/index.ts"
import { sourceFixtures } from "./fixtures.ts"

const roots: string[] = []
export function library(owner: string, populated = false) {
  const root = mkdtempSync(join(tmpdir(), "logical-backup-"))
  roots.push(root)
  const paths = { databasePath: join(root, "db.sqlite"), privateDataRoot: join(root, "data") }
  const storage = openStorage(paths)
  storage.close()
  const { sqlite } = openDatabase(paths.databasePath)
  sqlite
    .prepare("INSERT INTO auth_users (id, name, email) VALUES (?, ?, ?)")
    .run(owner, "PRIVATE IDENTITY", `${owner}@private.invalid`)
  sqlite
    .prepare(
      "INSERT INTO auth_accounts (id, account_id, provider_id, user_id, password) VALUES ('account', ?, 'credential', ?, 'PASSWORD-CANARY')",
    )
    .run(owner, owner)
  sqlite
    .prepare(
      "INSERT INTO auth_sessions (id, expires_at, token, user_id) VALUES ('session', 9999999999999, 'SESSION-CANARY', ?)",
    )
    .run(owner)
  sqlite
    .prepare(
      "INSERT INTO auth_verifications (id, identifier, value, expires_at) VALUES ('verification', 'PRIVATE IDENTITY', 'VERIFICATION-CANARY', 9999999999999)",
    )
    .run()
  sqlite.close()
  if (populated) {
    const source = sourceFixtures()
    const bytes = Buffer.from("Synthetic immutable source")
    const hash = createHash("sha256").update(bytes).digest("hex")
    const opened = openStorage(paths)
    const blob = opened.blobs.pathFor(hash)
    mkdirSync(dirname(blob), { recursive: true })
    writeFileSync(blob, bytes)
    opened.sources.persistDocument({
      edition: { ...source.edition, originalHash: hash, originalBlobHash: hash },
      normalization: { ...source.normalization, editionHash: hash },
    })
    opened.sources.createStudy({ id: "study-1", ownerId: owner, editionId: "edition-1" })
    opened.close()
  }
  return paths
}
export function cleanupLibraries(): void {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
}
