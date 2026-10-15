import { mkdtemp, readFile, rm } from "node:fs/promises"
import { request } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { startLocalLogCapture } from "./local-log-capture.ts"

const directory = await mkdtemp(join(tmpdir(), "studio-local-log-"))
const captures: Awaited<ReturnType<typeof startLocalLogCapture>>[] = []

afterEach(async () => {
  await Promise.all(captures.splice(0).map((capture) => capture.close()))
  await rm(directory, { recursive: true, force: true })
})

function event(trace: string, additions: Record<string, unknown> = {}): string {
  return JSON.stringify({
    event: "auth.login.rejected",
    category: "invalid-credentials",
    level: "warn",
    status: 401,
    upstream_status: 401,
    method: "POST",
    requestId: trace,
    trace_id: trace,
    route: "/login",
    ...additions,
  })
}

describe("local log capture", () => {
  it("exposes allowlisted events on loopback and filters by trace ID", async () => {
    // Given two valid server login events, when an agent queries one trace, then only that safe event is returned.
    const capture = await startLocalLogCapture(join(directory, "events.jsonl"))
    captures.push(capture)
    const first = "70000000-0000-4000-8000-000000000001"
    const second = "70000000-0000-4000-8000-000000000002"
    await capture.recordLine(event(first))
    await capture.recordLine(event(second))
    const response = await fetch(`${capture.url}/events?trace_id=${first}`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ events: [JSON.parse(event(first))] })
  })

  it("drops unknown fields, non-JSON output, and invalid trace IDs", async () => {
    // Given arbitrary stdout and a forged event, when recorded, then no unapproved data enters the log.
    const path = join(directory, "filtered.jsonl")
    const capture = await startLocalLogCapture(path)
    captures.push(capture)
    await capture.recordLine("ordinary server startup output")
    await capture.recordLine(
      event("70000000-0000-4000-8000-000000000003", { password: "private-canary" }),
    )
    const invalid = await fetch(`${capture.url}/events?trace_id=not-a-uuid`)
    expect(invalid.status).toBe(400)
    expect(await readFile(path, "utf8")).toBe("")
  })

  it("rejects non-loopback request hosts", async () => {
    // Given the loopback diagnostic endpoint, when the Host header targets an external name, then it denies access.
    const capture = await startLocalLogCapture(join(directory, "host.jsonl"))
    captures.push(capture)
    const status = await new Promise<number>((resolveStatus, rejectStatus) => {
      const probe = request(capture.url, { headers: { host: "attacker.example" } }, (response) => {
        response.resume()
        response.once("end", () => resolveStatus(response.statusCode ?? 0))
      })
      probe.once("error", rejectStatus)
      probe.end()
    })
    expect(status).toBe(403)
  })
})
