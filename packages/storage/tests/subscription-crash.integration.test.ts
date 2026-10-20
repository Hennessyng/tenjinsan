import { fork } from "node:child_process"
import { once } from "node:events"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import Database from "better-sqlite3"
import { expect, it, vi } from "vitest"
import { z } from "zod"

it("reaps an official-tool-shaped process that ignores stdin when its API parent crashes", async () => {
  // Given
  const network = vi.fn(async () => {
    throw new TypeError("Network forbidden")
  })
  vi.stubGlobal("fetch", network)
  const directory = await mkdtemp(join(tmpdir(), "ten21-crash-"))
  const binary = join(directory, "codex-fixture")
  await writeFile(
    binary,
    `#!/bin/sh\nexec "${process.execPath}" "${resolve("packages/storage/tests/subscription-codex-fixture.cjs")}" fixture:orphan "$@"\n`,
    { mode: 0o700 },
  )
  const parent = fork(
    resolve("packages/storage/tests/subscription-crash-parent.mjs"),
    [join(directory, "generation")],
    {
      execArgv: ["--experimental-transform-types"],
      stdio: ["ignore", "ignore", "pipe", "ipc"],
      env: { PATH: process.env["PATH"], STUDIO_SUBSCRIPTION_CODEX_BINARY: binary },
    },
  )
  let toolPid: number | undefined
  const exists = () => {
    if (toolPid === undefined) return false
    try {
      process.kill(toolPid, 0)
      return true
    } catch (error) {
      if (z.object({ code: z.literal("ESRCH") }).safeParse(error).success) return false
      throw error
    }
  }
  try {
    const [message] = await once(parent, "message", { signal: AbortSignal.timeout(10000) })
    toolPid = z.object({ pid: z.number().int().positive() }).parse(message).pid
    expect(exists()).toBe(true)
    const contender = new Database(join(directory, "session-process-lock.sqlite"), { timeout: 0 })
    try {
      expect(() => contender.exec("BEGIN EXCLUSIVE")).toThrow()
    } finally {
      contender.close()
    }
    // When
    parent.kill("SIGKILL")
    await once(parent, "exit")
    // Then
    await expect.poll(exists, { timeout: 2000 }).toBe(false)
    const recovered = new Database(join(directory, "session-process-lock.sqlite"), { timeout: 0 })
    try {
      expect(() => recovered.exec("BEGIN EXCLUSIVE")).not.toThrow()
    } finally {
      recovered.close()
    }
    expect(network).not.toHaveBeenCalled()
  } finally {
    parent.kill("SIGKILL")
    if (toolPid !== undefined && exists()) process.kill(toolPid, "SIGKILL")
    await rm(directory, { recursive: true, force: true })
    vi.unstubAllGlobals()
  }
})
