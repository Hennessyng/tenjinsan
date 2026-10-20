import { type ChildProcessByStdio, spawn } from "node:child_process"
import { realpathSync, rmSync } from "node:fs"
import { basename, dirname } from "node:path"
import type { Readable, Writable } from "node:stream"
import Database from "better-sqlite3"
import { z } from "zod"

const [lockPath, binary, ...args] = process.argv.slice(2)
if (!lockPath || !binary || !process.connected) process.exit(1)
const scratch = process.cwd()
if (!basename(scratch).startsWith("tenjinsan-study-") || dirname(scratch) !== realpathSync("/tmp"))
  process.exit(1)
const lock = new Database(lockPath, { timeout: 0 })
try {
  lock.exec("BEGIN EXCLUSIVE")
} catch (error) {
  lock.close()
  if (!z.object({ code: z.literal("SQLITE_BUSY") }).safeParse(error).success) throw error
  process.exit(1)
}
let child: ChildProcessByStdio<Writable, Readable, null> | undefined
let stopping = false
const stop = () => {
  if (stopping) return
  stopping = true
  if (!child?.pid) return
  try {
    process.kill(-child.pid, "SIGKILL")
  } catch (error) {
    if (!z.object({ code: z.literal("ESRCH") }).safeParse(error).success) throw error
  }
}
process.once("disconnect", stop)
process.on("message", (message) => {
  if (message === "stop") stop()
})
process.once("SIGTERM", stop)
process.once("SIGINT", stop)
if (!process.connected || process.ppid === 1) {
  lock.close()
  process.exit(1)
}
child = spawn(binary, args, { detached: true, env: process.env, stdio: ["pipe", "pipe", "ignore"] })
child.on("error", stop)
child.stdin.on("error", stop)
process.stdin.on("error", stop)
process.stdout.on("error", stop)
process.stdin.on("end", stop)
process.stdin.pipe(child.stdin)
child.stdout.pipe(process.stdout)
child.once("close", () => {
  // Keep the credential-process lock until the child is reaped, including after the API parent dies.
  rmSync(scratch, { recursive: true, force: true })
  lock.close()
  process.exit(0)
})
