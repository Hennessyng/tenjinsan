import { describe, expect, it } from "vitest"
import { z } from "zod"
import { createApp, type SecurityEvent } from "../app.ts"

const origin = "http://127.0.0.1:8787"
function fixture() {
  const events: SecurityEvent[] = []
  const app = createApp({
    auth: { ownerId: async () => null, handler: async () => new Response(null, { status: 401 }) },
    security: {
      apiBodyBytes: 1024,
      loginBodyBytes: 16384,
      uploadBodyBytes: 1024,
      loginRateLimit: { attempts: 5, windowMs: 60_000 },
      trustedOrigins: [origin],
      trustProxy: false,
      logger: (event) => events.push(event),
    },
  })
  const submit = (headers: Record<string, string> = { origin }, size = 0) =>
    app.request(`${origin}/login`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
      body: new URLSearchParams({
        email: "synthetic@example.test",
        password: "canary",
        pad: "x".repeat(size),
      }),
    })
  return { app, submit, events }
}

describe("TEN-17 early form rejection", () => {
  it.each(["origin", "missing-origin", "rate", "body"] as const)(
    "presents matching safe visible trace for %s without changing status",
    async (kind) => {
      const { submit, events } = fixture()
      if (kind === "rate") for (let i = 0; i < 5; i += 1) expect((await submit()).status).toBe(401)
      const response = await submit(
        kind === "origin"
          ? { origin: "http://attacker.test" }
          : kind === "missing-origin"
            ? {}
            : { origin },
        kind === "body" ? 17000 : 0,
      )
      expect(response.status).toBe(kind === "rate" ? 429 : kind === "body" ? 413 : 403)
      const trace = z.uuid().parse(response.headers.get("x-trace-id"))
      expect(response.headers.get("x-request-id")).toBe(trace)
      const html = await response.text()
      expect(html).toContain(`data-trace-id>${trace}</code>`)
      expect(html).toContain('role="alert"')
      expect(response.headers.get("content-type")).toContain("text/html")
      expect(response.headers.get("set-cookie")).toBeNull()
      expect(html).not.toContain("synthetic@example.test")
      expect(html).not.toContain("canary")
      expect(events.at(-1)).toMatchObject({
        requestId: trace,
        trace_id: trace,
        status: response.status,
      })
    },
  )

  it("retains non-login rejection presentation and origin-before-body ordering", async () => {
    const { app, submit } = fixture()
    const response = await app.request(`${origin}/api/library-context`, {
      headers: { origin: "http://attacker.test" },
    })
    expect(response.status).toBe(403)
    expect(await response.text()).toBe("Request rejected")
    expect((await submit({ origin: "http://attacker.test" }, 17000)).status).toBe(403)
  })
})
