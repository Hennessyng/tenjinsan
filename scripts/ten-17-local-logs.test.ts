import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { recoveryFixture } from "../tests/deployment/ten-17-owner-recovery-fixture.ts"

const firstTrace = "70000000-0000-4000-8000-000000000001"
const secondTrace = "70000000-0000-4000-8000-000000000002"
function safeEvent(trace = firstTrace, requestId = trace) {
  return {
    event: "auth.login.rejected",
    category: "invalid-credentials",
    level: "warn",
    status: 401,
    upstream_status: 401,
    method: "POST",
    requestId,
    trace_id: trace,
    route: "/login",
  }
}

describe("TEN-17 public launch-local logs", () => {
  it("accepts exactly one transport separator and returns only matching strict evidence", async () => {
    const fixture = await recoveryFixture()
    try {
      const root = join(fixture.environment["PRIVATE_DATA_ROOT"] ?? "", "diagnostics")
      await mkdir(root)
      await writeFile(
        join(root, "events.jsonl"),
        [safeEvent(), safeEvent(secondTrace)].map((event) => JSON.stringify(event)).join("\n"),
      )
      const result = fixture.logs(firstTrace)
      expect(result.status).toBe(0)
      expect(JSON.parse(result.stdout)).toEqual({ trace_id: firstTrace, events: [safeEvent()] })
      expect(result.stderr).not.toContain("owner@example.test")
    } finally {
      await fixture.close()
    }
  })

  it("rejects an inconsistent request ID without outputting the row", async () => {
    const fixture = await recoveryFixture()
    try {
      const root = join(fixture.environment["PRIVATE_DATA_ROOT"] ?? "", "diagnostics")
      await mkdir(root)
      await writeFile(
        join(root, "events.jsonl"),
        JSON.stringify(safeEvent(firstTrace, secondTrace)),
      )
      const result = fixture.logs(firstTrace, ["--trace-id", firstTrace])
      expect(result.status).toBe(1)
      expect(result.stdout).toBe("")
      expect(result.stderr).not.toContain(secondTrace)
    } finally {
      await fixture.close()
    }
  })

  it.each(["missing", "empty"])(
    "reports %s evidence as unavailable without a cause",
    async (kind) => {
      const fixture = await recoveryFixture()
      try {
        if (kind === "empty") {
          const root = join(fixture.environment["PRIVATE_DATA_ROOT"] ?? "", "diagnostics")
          await mkdir(root)
          await writeFile(join(root, "events.jsonl"), "")
        }
        const result = fixture.logs(firstTrace, ["--trace-id", firstTrace])
        expect(result.status).toBe(1)
        expect(result.stdout).not.toBe("")
        const value = JSON.parse(result.stdout)
        expect(value).toMatchObject({ trace_id: firstTrace, evidence: "unavailable", events: [] })
        expect(value.guidance).toMatch(/before restarting/)
        expect(value.guidance).toMatch(/does not establish a failure cause/)
        expect(result.stderr).not.toContain(fixture.fixture.directory)
      } finally {
        await fixture.close()
      }
    },
  )

  it.each(
    [
      ["--", "--", "--trace-id", firstTrace],
      ["--trace-id", "private-canary"],
      ["--trace-id", firstTrace, "--password", "private-canary"],
    ].map((args) => ({ args })),
  )("rejects malformed public args without echoing untrusted values (%#)", async ({ args }) => {
    const fixture = await recoveryFixture()
    try {
      const result = fixture.logs(firstTrace, args)
      expect(result.status).toBe(2)
      expect(result.stdout).toBe("")
      expect(result.stderr).not.toContain("private-canary")
    } finally {
      await fixture.close()
    }
  })

  it.each(["{malformed", JSON.stringify({ ...safeEvent(), password: "private-canary" })])(
    "fails closed on corrupt or unallowlisted evidence (%#)",
    async (content) => {
      const fixture = await recoveryFixture()
      try {
        const root = join(fixture.environment["PRIVATE_DATA_ROOT"] ?? "", "diagnostics")
        await mkdir(root)
        await writeFile(join(root, "events.jsonl"), content)
        const result = fixture.logs(firstTrace, ["--trace-id", firstTrace])
        expect(result.status).toBe(1)
        expect(result.stdout).toBe("")
        expect(result.stderr).not.toContain("private-canary")
        expect(result.stderr).not.toContain(content)
      } finally {
        await fixture.close()
      }
    },
  )
})
