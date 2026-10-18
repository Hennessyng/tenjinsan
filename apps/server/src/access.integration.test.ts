import { describe, expect, it } from "vitest"
import { createApp, type SecurityEvent } from "./app.ts"

const origin = "http://studio.test"
function fixture() {
  const events: SecurityEvent[] = []
  const app = createApp({
    libraryOwnerId: "library-owner",
    configurePrivateApi: (api) => {
      api.get("/api/jobs/:id", (context) => context.json({ ownerId: context.get("ownerId") }))
      api.post("/api/jobs/:id", (context) => context.body(null, 202))
      api.post("/api/books/:id/upload", (context) => context.body(null, 202))
      api.get("/api/artifacts/:id/download", (context) => context.text("library output"))
      api.post("/api/backups", (context) => context.body(null, 202))
    },
    security: {
      apiBodyBytes: 64,
      uploadBodyBytes: 16,
      loginBodyBytes: 1024,
      loginRateLimit: { attempts: 2, windowMs: 60000 },
      trustedOrigins: [origin],
      trustProxy: false,
      logger: (event) => events.push(event),
      resourceAccess: {
        canAccess: async (_ownerId, resource) =>
          resource.id === `owned-${resource.kind.slice(0, -1)}`,
      },
    },
  })
  return { app, events }
}

describe("anonymous library retains non-auth request boundaries", () => {
  it.each(["/api/jobs/owned-job", "/api/artifacts/owned-artifact/download"])(
    "opens %s without a cookie",
    async (path) => {
      expect((await fixture().app.request(origin + path)).status).toBe(200)
    },
  )
  it("requires canonical Host rather than trusting forwarded attacker headers", async () => {
    const { app } = fixture()
    expect(
      (
        await app.request(origin + "/api/jobs/owned-job", {
          headers: { host: "attacker.example", "x-forwarded-host": "studio.test" },
        })
      ).status,
    ).toBe(421)
  })
  it.each([undefined, "https://attacker.example"])(
    "rejects missing/foreign mutation origin %s",
    async (value) => {
      const headers = new Headers({ "content-type": "application/json" })
      if (value !== undefined) headers.set("origin", value)
      expect(
        (
          await fixture().app.request(origin + "/api/jobs/owned-job", {
            method: "POST",
            headers,
            body: "{}",
          })
        ).status,
      ).toBe(403)
    },
  )
  it("preserves resource ownership and traversal isolation", async () => {
    const { app } = fixture()
    expect((await app.request(origin + "/api/jobs/guessed-job")).status).toBe(404)
    expect((await app.request(origin + "/api/jobs/%2e%2e%2fprivate")).status).toBe(400)
  })
  it("retains content type and API size limits without authentication", async () => {
    const { app } = fixture()
    expect(
      (
        await app.request(origin + "/api/jobs/owned-job", {
          method: "POST",
          headers: { origin, "content-type": "text/plain" },
          body: "x",
        })
      ).status,
    ).toBe(415)
    expect(
      (
        await app.request(origin + "/api/jobs/owned-job", {
          method: "POST",
          headers: { origin, "content-type": "application/json" },
          body: JSON.stringify({ data: "x".repeat(80) }),
        })
      ).status,
    ).toBe(413)
  })
  it("bounds uploads and permits valid anonymous commands", async () => {
    const { app } = fixture()
    const headers = { origin, "content-type": "application/epub+zip" }
    expect(
      (
        await app.request(origin + "/api/books/owned-book/upload", {
          method: "POST",
          headers,
          body: new Uint8Array(17),
        })
      ).status,
    ).toBe(413)
    expect(
      (
        await app.request(origin + "/api/books/owned-book/upload", {
          method: "POST",
          headers,
          body: new Uint8Array(8),
        })
      ).status,
    ).toBe(202)
    expect(
      (
        await app.request(origin + "/api/backups", {
          method: "POST",
          headers: { origin, "content-type": "application/json" },
          body: "{}",
        })
      ).status,
    ).toBe(202)
  })
  it("keeps rejection correlation without reflecting identities, bodies or injected IDs", async () => {
    const { app, events } = fixture()
    const response = await app.request(origin + "/api/jobs/private-canary", {
      headers: { "x-request-id": "private-canary" },
    })
    expect(response.status).toBe(404)
    expect(events).toHaveLength(1)
    expect(events[0]?.trace_id).toBe(response.headers.get("x-trace-id"))
    expect(JSON.stringify(events)).not.toContain("private-canary")
    expect(JSON.stringify(events)).not.toContain("library-owner")
  })
})
