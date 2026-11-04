import type Database from "better-sqlite3"
import { z } from "zod"
import { fullBookAttempts } from "./full-book-execution-history.ts"
import { validateImportedSource } from "./full-book-import-accounting.ts"

export function fullBookSourceCommitments(sqlite: Database.Database, owner: string, hash: string) {
  validateImportedSource(sqlite, owner, hash)
  const consents = z
    .array(z.object({ id: z.string() }))
    .parse(
      sqlite
        .prepare("SELECT id FROM full_book_consents WHERE owner_id=? AND source_hash=?")
        .all(owner, hash),
    )
  for (const consent of consents) fullBookAttempts(sqlite, consent.id)
  const row = sqlite
    .prepare(
      "SELECT spent,held FROM full_book_source_commitments WHERE owner_id=? AND source_hash=?",
    )
    .get(owner, hash)
  return row
    ? z
        .object({ spent: z.number().int().nonnegative(), held: z.number().int().nonnegative() })
        .readonly()
        .parse(row)
    : Object.freeze({ spent: 0, held: 0 })
}
