import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { startLocalLogCapture } from "./local-log-capture.ts"

const trace = "70000000-0000-4000-8000-000000000010"
const event = JSON.stringify({
  event: "auth.login.rejected",
  category: "invalid-credentials",
  level: "warn",
  status: 401,
  method: "POST",
  route: "/login",
  requestId: trace,
  trace_id: trace,
})

describe("TEN-17 bounded private capture", () => {
  it("enforces 4096-byte event and 2097152-byte file caps, private modes and restart clearing", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ten17-capture-"))
    const path = join(directory, "diagnostics/events.jsonl")
    let capture = await startLocalLogCapture(path)
    try {
      expect((await stat(join(directory, "diagnostics"))).mode & 0o777).toBe(0o700)
      expect((await stat(path)).mode & 0o777).toBe(0o600)
      await capture.recordLine(" ".repeat(4097 - Buffer.byteLength(event)) + event)
      expect(await readFile(path, "utf8")).toBe("")
      await capture.recordLine(" ".repeat(4096 - Buffer.byteLength(event)) + event)
      expect(await (await fetch(`${capture.url}/events?trace_id=${trace}`)).json()).toEqual({
        events: [JSON.parse(event)],
      })
      await writeFile(path, " ".repeat(2_097_152))
      await capture.recordLine(event)
      expect((await stat(path)).size).toBe(2_097_152)
      await capture.close()
      capture = await startLocalLogCapture(path)
      expect(await readFile(path, "utf8")).toBe("")
      expect(await (await fetch(`${capture.url}/events?trace_id=${trace}`)).json()).toEqual({
        events: [],
      })
    } finally {
      await capture.close()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("keeps delayed delivery distinct from invalid/dropped evidence without leaking canaries", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ten17-capture-"))
    const capture = await startLocalLogCapture(join(directory, "events.jsonl"))
    try {
      await capture.recordLine(
        JSON.stringify({ ...JSON.parse(event), email: "private-canary", token: "private-token" }),
      )
      expect(await (await fetch(`${capture.url}/events?trace_id=${trace}`)).json()).toEqual({
        events: [],
      })
      await new Promise((resolve) => setTimeout(resolve, 25))
      await capture.recordLine(event)
      const retained = await (await fetch(`${capture.url}/events?trace_id=${trace}`)).text()
      expect(JSON.parse(retained)).toEqual({ events: [JSON.parse(event)] })
      expect(await readFile(capture.path, "utf8")).not.toContain("private-canary")
      expect(retained).not.toContain("private-token")
      await writeFile(
        capture.path,
        JSON.stringify({ ...JSON.parse(event), requestId: crypto.randomUUID() }),
      )
      expect((await fetch(`${capture.url}/events?trace_id=${trace}`)).status).toBe(500)
    } finally {
      await capture.close()
      await rm(directory, { recursive: true, force: true })
    }
  })
})
