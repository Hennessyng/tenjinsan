import { once } from "node:events"
import { mkdtemp, rm } from "node:fs/promises"
import { request } from "node:http"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { serve } from "@hono/node-server"
import { openAuthStorage } from "@reading-studio/storage"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createApp, type SecurityEvent } from "./app.ts"
import { createOwnerAuth, createServerAuth } from "./auth/auth.ts"
import { createOwnerService } from "./auth/owner.ts"

const EMAIL = "owner@example.test"
const PASSWORD = "correct horse battery staple"
const SECRET = "access-test-secret-with-at-least-thirty-two-characters"

type Harness = {
  readonly close: () => Promise<void>
  readonly cookie: string
  readonly events: SecurityEvent[]
  readonly origin: string
}

async function availablePort(): Promise<number> {
  const server = createServer()
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => (error === undefined ? resolveClose() : rejectClose(error)))
  })
  if (address === null || typeof address === "string") {
    throw new TypeError("Unable to allocate an access-test port")
  }
  return address.port
}

async function createHarness(): Promise<Harness> {
  const directory = await mkdtemp(join(tmpdir(), "reading-studio-access-"))
  const port = await availablePort()
  const origin = `http://127.0.0.1:${port}`
  const storage = openAuthStorage(join(directory, "studio.sqlite"))
  const config = { baseURL: origin, secret: SECRET, sessionExpiresIn: 60 * 60 }
  await createOwnerService(storage, createOwnerAuth(storage, config)).provision({
    email: EMAIL,
    name: "Studio Owner",
    password: PASSWORD,
  })
  const auth = createServerAuth(storage, config)
  const events: SecurityEvent[] = []
  const app = createApp({
    auth: {
      handler: auth.handler,
      ownerId: async (headers) => (await auth.api.getSession({ headers }))?.user.id ?? null,
    },
    configurePrivateApi: (privateApi) => {
      privateApi.get("/api/jobs/:id", (context) =>
        context.json({ ownerId: context.get("ownerId") }),
      )
      privateApi.post("/api/jobs/:id", async (context) => {
        await context.req.json()
        return context.body(null, 202)
      })
      privateApi.post("/api/books/:id/upload", async (context) => {
        await context.req.arrayBuffer()
        return context.body(null, 202)
      })
      privateApi.get("/api/artifacts/:id/download", (context) => context.text("private"))
      privateApi.post("/api/backups", async (context) => {
        await context.req.json()
        return context.body(null, 202)
      })
    },
    security: {
      apiBodyBytes: 64,
      loginBodyBytes: 1_024,
      loginRateLimit: { attempts: 2, windowMs: 60_000 },
      logger: (event) => events.push(event),
      resourceAccess: {
        canAccess: async (_ownerId, resource) =>
          resource.id === `owned-${resource.kind.slice(0, -1)}`,
      },
      trustedOrigins: [origin],
      trustProxy: false,
      uploadBodyBytes: 16,
    },
  })
  const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port })
  if (!server.listening) await once(server, "listening")
  const login = await fetch(`${origin}/api/auth/sign-in/email`, {
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    headers: { "content-type": "application/json", origin },
    method: "POST",
  })
  const cookie = login.headers.getSetCookie()[0]?.split(";", 1)[0]
  if (cookie === undefined) throw new TypeError("Owner sign-in did not set a session cookie")
  return {
    cookie,
    events,
    origin,
    close: async () => {
      await new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => (error === undefined ? resolveClose() : rejectClose(error)))
      })
      storage.close()
      await rm(directory, { recursive: true })
    },
  }
}

function ownerHeaders(harness: Harness, contentType?: string): Headers {
  const headers = new Headers({ cookie: harness.cookie, origin: harness.origin })
  if (contentType !== undefined) headers.set("content-type", contentType)
  return headers
}

async function hostileHostStatus(origin: string): Promise<number> {
  return new Promise((resolveStatus, rejectRequest) => {
    const outgoing = request(`${origin}/api/jobs/owned-job`, {
      headers: { host: "attacker.example" },
    })
    outgoing.once("response", (response) => {
      response.resume()
      resolveStatus(response.statusCode ?? 0)
    })
    outgoing.once("error", rejectRequest)
    outgoing.end()
  })
}

let harness: Harness

beforeAll(async () => {
  harness = await createHarness()
})

afterAll(async () => {
  await harness.close()
})

describe("owner-only API access boundaries", () => {
  it.each([
    ["job", "/api/jobs/owned-job", "GET"],
    ["upload", "/api/books/owned-book/upload", "POST"],
    ["download", "/api/artifacts/owned-artifact/download", "GET"],
    ["backup", "/api/backups", "POST"],
  ])("keeps private %s routes unavailable without a session", async (_label, path, method) => {
    const response = await fetch(`${harness.origin}${path}`, { method })
    expect(response.status).toBe(401)
  })

  it("rejects a Host outside the canonical allowlist", async () => {
    expect(await hostileHostStatus(harness.origin)).toBe(421)
  })

  it("rejects a cross-origin private mutation with a valid owner session", async () => {
    const response = await fetch(`${harness.origin}/api/jobs/owned-job`, {
      body: "{}",
      headers: {
        cookie: harness.cookie,
        "content-type": "application/json",
        origin: "https://attacker.example",
      },
      method: "POST",
    })
    expect(response.status).toBe(403)
  })

  it("requires an Origin on a private mutation", async () => {
    const response = await fetch(`${harness.origin}/api/jobs/owned-job`, {
      body: "{}",
      headers: { cookie: harness.cookie, "content-type": "application/json" },
      method: "POST",
    })
    expect(response.status).toBe(403)
  })

  it("hides a well-shaped resource ID that the owner cannot access", async () => {
    const response = await fetch(`${harness.origin}/api/jobs/guessed-job`, {
      headers: ownerHeaders(harness),
    })
    expect(response.status).toBe(404)
  })

  it("rejects a traversal-like resource ID before resource lookup", async () => {
    const response = await fetch(`${harness.origin}/api/jobs/%2e%2e%2fprivate`, {
      headers: ownerHeaders(harness),
    })
    expect(response.status).toBe(400)
  })

  it("rejects the wrong content type before parsing a private mutation", async () => {
    const response = await fetch(`${harness.origin}/api/jobs/owned-job`, {
      body: "not json",
      headers: ownerHeaders(harness, "text/plain"),
      method: "POST",
    })
    expect(response.status).toBe(415)
  })

  it("bounds private upload bodies", async () => {
    const response = await fetch(`${harness.origin}/api/books/owned-book/upload`, {
      body: new Uint8Array(17),
      headers: ownerHeaders(harness, "application/epub+zip"),
      method: "POST",
    })
    expect(response.status).toBe(413)
  })

  it("allows the owner through guarded job, upload, and download routes", async () => {
    const job = await fetch(`${harness.origin}/api/jobs/owned-job`, {
      body: "{}",
      headers: ownerHeaders(harness, "application/json"),
      method: "POST",
    })
    const upload = await fetch(`${harness.origin}/api/books/owned-book/upload`, {
      body: new Uint8Array(8),
      headers: ownerHeaders(harness, "application/epub+zip"),
      method: "POST",
    })
    const download = await fetch(`${harness.origin}/api/artifacts/owned-artifact/download`, {
      headers: ownerHeaders(harness),
    })
    expect([job.status, upload.status, download.status]).toEqual([202, 202, 200])
  })

  it("rejects an oversized Better Auth sign-in before creating a session", async () => {
    const response = await fetch(`${harness.origin}/api/auth/sign-in/email`, {
      body: JSON.stringify({ email: EMAIL, padding: "x".repeat(2_048), password: PASSWORD }),
      headers: { "content-type": "application/json", origin: harness.origin },
      method: "POST",
    })
    const sessionCookie = response.headers.get("set-cookie")?.split(";", 1)[0]
    const session =
      sessionCookie === undefined
        ? null
        : await (
            await fetch(`${harness.origin}/api/auth/get-session`, {
              headers: { cookie: sessionCookie },
            })
          ).json()

    expect({
      sessionCreated: session !== null,
      status: response.status,
    }).toEqual({ sessionCreated: false, status: 413 })
  })

  it("rate-limits repeated failed owner sign-ins", async () => {
    const attempt = () =>
      fetch(`${harness.origin}/api/auth/sign-in/email`, {
        body: JSON.stringify({ email: EMAIL, password: "wrong-password-value" }),
        headers: { "content-type": "application/json", origin: harness.origin },
        method: "POST",
      })
    expect((await attempt()).status).toBe(401)
    expect((await attempt()).status).toBe(401)
    expect((await attempt()).status).toBe(429)
  })

  it("logs security decisions without credentials, cookies, or resource IDs", async () => {
    await fetch(`${harness.origin}/api/jobs/private-id-canary`, {
      headers: { cookie: "session=private-cookie-canary", origin: harness.origin },
    })
    const serialized = JSON.stringify(harness.events)
    expect(serialized).not.toContain("private-cookie-canary")
    expect(serialized).not.toContain("private-id-canary")
    expect(serialized).not.toContain(PASSWORD)
    expect(harness.events.length).toBeGreaterThan(0)
  })
})
