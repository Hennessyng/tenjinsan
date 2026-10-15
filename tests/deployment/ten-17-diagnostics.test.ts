import { readFile, rm, stat, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { expect, it } from "vitest"
import { z } from "zod"
import { safeLocalEventSchema, startLocalLogCapture } from "../../scripts/local-log-capture.ts"
import { ownerEmail, recoveryFixture, retainedEvent } from "./ten-17-owner-recovery-fixture.ts"

it("joins actual browser failure UUIDs to public safe lookup and separate evidence gaps", async () => {
  const fixture = await recoveryFixture()
  try {
    expect(fixture.tty()).toBe(0)
    const ready = await fixture.start()
    const context = await fixture.context()
    const page = await context.newPage()
    const traces: string[] = []
    for (let i = 0; i < 2; i += 1) {
      await page.goto(`${fixture.origin}/login`)
      await page.getByLabel("Email").fill(ownerEmail)
      await page.getByLabel("Password").fill("ten17-private-password-canary")
      const rejected = page.waitForResponse(
        (response) =>
          response.url() === `${fixture.origin}/login` && response.request().method() === "POST",
      )
      await page.getByRole("button", { name: "Log in" }).click()
      const response = await rejected
      expect(response.status()).toBe(401)
      traces.push(z.uuid().parse(response.headers()["x-trace-id"]))
    }
    const first = z.uuid().parse(traces[0])
    const second = z.uuid().parse(traces[1])
    expect(first).not.toBe(second)
    await retainedEvent(ready.diagnosticEventsUrl, first)
    await retainedEvent(ready.diagnosticEventsUrl, second)
    const result = fixture.logs(first)
    expect(result.status).toBe(0)
    const found = z
      .object({ trace_id: z.uuid(), events: z.array(safeLocalEventSchema) })
      .parse(JSON.parse(result.stdout))
    expect(found.trace_id).toBe(first)
    expect(found.events.length).toBeGreaterThan(0)
    expect(
      found.events.every((event) => event.trace_id === first && event.requestId === first),
    ).toBe(true)
    expect(found.events).toContainEqual(
      expect.objectContaining({ category: "invalid-credentials", status: 401 }),
    )
    const disk = await readFile(ready.diagnosticEventsFile, "utf8")
    for (const canary of [
      ownerEmail,
      "ten17-private-password-canary",
      "cookie",
      "token",
      "requestBody",
      "rawError",
    ]) {
      expect(result.stdout + result.stderr + disk).not.toContain(canary)
    }
    expect((await stat(ready.diagnosticEventsFile)).mode & 0o777).toBe(0o600)
    expect((await stat(dirname(ready.diagnosticEventsFile))).mode & 0o777).toBe(0o700)
    await fixture.stop()
    await fixture.start()
    expect(fixture.logs(first).status).toBe(1)
    expect(JSON.parse(fixture.logs(first).stdout)).toMatchObject({
      evidence: "unavailable",
      events: [],
    })
    await fixture.stop()
    const capture = await startLocalLogCapture(ready.diagnosticEventsFile)
    try {
      const event = safeLocalEventSchema.parse(found.events[0])
      const line = JSON.stringify(event)
      await capture.recordLine(" ".repeat(4097 - Buffer.byteLength(line)) + line)
      expect(JSON.parse(fixture.logs(first).stdout)).toMatchObject({
        evidence: "unavailable",
        events: [],
      })
      const other = JSON.stringify({ ...event, requestId: second, trace_id: second }) + "\n"
      const count = Math.floor(2_097_152 / Buffer.byteLength(other))
      await writeFile(capture.path, other.repeat(count))
      await capture.recordLine(line)
      expect((await stat(capture.path)).size).toBeLessThanOrEqual(2_097_152)
      const capped = fixture.logs(first)
      expect(capped.status).toBe(1)
      expect(JSON.parse(capped.stdout)).toMatchObject({ evidence: "unavailable", events: [] })
      await writeFile(capture.path, "")
      await capture.recordLine(line)
      expect(fixture.logs(first).status).toBe(0)
    } finally {
      await capture.close()
    }
    await rm(ready.diagnosticEventsFile)
    const missing = fixture.logs(first)
    expect(missing.status).toBe(1)
    expect(JSON.parse(missing.stdout)).toMatchObject({ evidence: "unavailable", events: [] })
    expect(JSON.parse(missing.stdout).guidance).toMatch(/before restarting/)
  } finally {
    await fixture.close()
  }
}, 120_000)
