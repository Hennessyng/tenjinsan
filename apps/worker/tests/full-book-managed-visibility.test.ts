import { type ChildProcess, fork } from "node:child_process"
import { once } from "node:events"
import { existsSync, readFileSync, realpathSync, statSync, watch } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { FixtureDatabase } from "@reading-studio/storage/test-support"
import { afterEach, expect, it, vi } from "vitest"
import { z } from "zod"
import { executionClock as clock } from "./full-book-execution-fixture.ts"
import { managedProcess } from "./full-book-managed-process-fixture.ts"

afterEach(() => vi.unstubAllEnvs())
function launch(f: ReturnType<typeof managedProcess>, mode: "read" | "write") {
  return fork(
    fileURLToPath(new URL("./full-book-managed-visibility.process.ts", import.meta.url)),
    [
      JSON.stringify({
        mode,
        options: f.options,
        grantId: f.grant.id,
        now: clock.now,
        binary: f.grant.policy.build.binaryPath,
      }),
    ],
    { execArgv: ["--experimental-transform-types"], stdio: ["ignore", "ignore", "pipe", "ipc"] },
  )
}
function message(child: ChildProcess) {
  return new Promise<unknown>((resolve, reject) => {
    child.once("message", resolve)
    child.once("error", reject)
    child.once("exit", () => reject(new TypeError("Visibility probe exited before observation")))
  })
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, "exit")
  child.kill("SIGKILL")
  await exited
}
it("keeps committed native charges visible across an independent process and SIGKILL/reopen without checkpoint or owner close", async () => {
  // Given a live owner connection and an independently executing managed writer with only a fake RPC process.
  const f = managedProcess("stall"),
    children: ChildProcess[] = []
  const turnWritten = Promise.withResolvers<void>()
  const watcher = watch(dirname(f.capture), () => {
    if (existsSync(f.capture) && readFileSync(f.capture, "utf8").includes('"method":"turn/start"'))
      turnWritten.resolve()
  })
  try {
    const writer = launch(f, "write")
    children.push(writer)
    expect(await message(writer)).toEqual({ kind: "ready" })
    await turnWritten.promise
    // When a brand-new process reads while the writer and owner are still open.
    const reader = launch(f, "read")
    children.push(reader)
    const observed = z
      .object({
        kind: z.literal("observed"),
        realpath: z.string(),
        dev: z.number(),
        ino: z.number(),
        inTransaction: z.boolean(),
        journal: z.string(),
        count: z.object({ counted: z.number() }),
      })
      .parse(await message(reader))
    const stat = statSync(f.options.databasePath)
    expect(observed).toMatchObject({
      realpath: realpathSync(f.options.databasePath),
      dev: stat.dev,
      ino: stat.ino,
      inTransaction: false,
      journal: "wal",
      count: { counted: 1 },
    })
    expect(
      JSON.parse(readFileSync(join(f.options.privateDataRoot, "before-write-ledger.json"), "utf8")),
    ).toEqual({ counted: 1 })
    // Then killing the writer cannot erase the committed charge; reopening/recovery retains unknown usage and requires owner action.
    expect(writer.exitCode).toBeNull()
    await stop(writer)
    expect(writer.signalCode).toBe("SIGKILL")
    f.storage.fullBookExecution.recover({ consentId: f.budget.id, now: clock.later })
    expect(f.storage.fullBookExecution.attempts(f.budget.id)).toHaveLength(1)
    expect(f.storage.fullBookExecution.attempts(f.budget.id)[0]).toMatchObject({
      state: "outcome_unknown",
      resolution: "awaiting-owner",
    })
    const db = new FixtureDatabase(f.options.databasePath, { readonly: true })
    try {
      expect(db.prepare("SELECT COUNT(*) AS counted FROM external_attempts").get()).toEqual({
        counted: 1,
      })
      expect(db.pragma("integrity_check", { simple: true })).toBe("ok")
    } finally {
      db.close()
    }
  } finally {
    watcher.close()
    await Promise.all(children.map(stop))
    f.cleanup()
  }
}, 15_000)
