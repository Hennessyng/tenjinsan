import { realpathSync, statSync } from "node:fs"
import { openStorage } from "@reading-studio/storage"
import {
  FixtureDatabase,
  registerSyntheticSubscriptionTool,
} from "@reading-studio/storage/test-support"
import { z } from "zod"

const input = z
  .object({
    mode: z.enum(["read", "write"]),
    options: z.object({ databasePath: z.string(), privateDataRoot: z.string() }),
    grantId: z.string(),
    now: z.string(),
    binary: z.string(),
  })
  .parse(JSON.parse(process.argv[2] ?? "null"))
if (input.mode === "read") {
  const db = new FixtureDatabase(input.options.databasePath, { readonly: true })
  try {
    const stat = statSync(db.name)
    process.send?.({
      kind: "observed",
      realpath: realpathSync(db.name),
      dev: stat.dev,
      ino: stat.ino,
      inTransaction: db.inTransaction,
      journal: db.pragma("journal_mode", { simple: true }),
      count: db
        .prepare("SELECT COUNT(*) AS counted FROM external_attempts WHERE state='dispatching'")
        .get(),
    })
  } finally {
    db.close()
    process.disconnect?.()
  }
} else {
  registerSyntheticSubscriptionTool(input.binary)
  process.env["STUDIO_SUBSCRIPTION_CODEX_BINARY"] = input.binary
  const storage = openStorage(input.options)
  try {
    process.send?.({ kind: "ready" })
    const result = await storage.fullBookManaged.run(input.grantId, {
      signal: new AbortController().signal,
      now: () => input.now,
    })
    process.send?.({ kind: "finished", result })
  } finally {
    storage.close()
    process.disconnect?.()
  }
}
