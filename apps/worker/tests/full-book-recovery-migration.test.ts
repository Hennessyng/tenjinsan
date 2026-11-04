import { readFileSync } from "node:fs"
import { FixtureDatabase } from "@reading-studio/storage/test-support"
import { expect, it } from "vitest"
import { recoveryFixture } from "./full-book-recovery-fixture.ts"

it("transactionally rebuilds the wire constraint without rewriting existing charged wires", () => {
  // Given a populated disposable ledger containing the two original-format wires and unknown charges.
  const f = recoveryFixture(),
    db = new FixtureDatabase(f.options.databasePath)
  try {
    const before = db.prepare("SELECT * FROM full_book_wires ORDER BY attempt_id").all()
    const attempts = f.storage.fullBookExecution.attempts(f.budget.id)
    const statements = readFileSync(
      new URL("../../../packages/storage/migrations/0024_first_map_recovery.sql", import.meta.url),
      "utf8",
    )
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
    const start = statements.findIndex((s) =>
      s.startsWith("DROP TRIGGER full_book_attempt_admission"),
    )
    const end = statements.findIndex((s) => s.startsWith("CREATE TRIGGER recovery_stop_claim"))
    if (start < 0 || end < start) throw new TypeError("Missing atomic wire migration section")
    // When the actual migration rebuild section runs atomically, then bytes, counters and foreign keys survive.
    db.transaction(() => {
      for (const statement of statements.slice(start, end)) db.exec(statement)
    }).immediate()
    expect(db.prepare("SELECT * FROM full_book_wires ORDER BY attempt_id").all()).toEqual(before)
    expect(f.storage.fullBookExecution.attempts(f.budget.id)).toEqual(attempts)
    expect(db.pragma("foreign_key_check")).toEqual([])
  } finally {
    db.close()
    f.cleanup()
  }
})
