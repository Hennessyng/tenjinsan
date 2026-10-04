import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import Database from "better-sqlite3"
import { expect, test } from "vitest"
import { openStorage } from "../src/storage.ts"

test("an idle worker does not take a writer lock while another process writes", () => {
  const directory = mkdtempSync(join(tmpdir(), "reading-idle-claim-"))
  const databasePath = join(directory, "studio.sqlite")
  const storage = openStorage({ databasePath, privateDataRoot: join(directory, "private") })
  const writer = new Database(databasePath)
  writer.exec("BEGIN IMMEDIATE")
  try {
    expect(
      storage.execution.claimNextJob({
        token: "idle-claim",
        now: "2026-09-24T00:00:00.000Z",
        expiresAt: "2026-09-24T00:02:00.000Z",
      }),
    ).toBeNull()
  } finally {
    writer.exec("ROLLBACK")
    writer.close()
    storage.close()
    rmSync(directory, { recursive: true, force: true })
  }
}, 8_000)
