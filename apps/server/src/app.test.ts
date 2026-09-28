import { describe, expect, it } from "vitest"
import { createApp } from "./app"

const app = createApp({
  auth: {
    handler: async () => new Response(null, { status: 404 }),
    ownerId: async () => null,
  },
  security: {
    apiBodyBytes: 1_048_576,
    loginBodyBytes: 16_384,
    loginRateLimit: { attempts: 5, windowMs: 60_000 },
    trustedOrigins: ["http://localhost"],
    trustProxy: false,
    uploadBodyBytes: 52_428_800,
  },
})

describe("GET /health", () => {
  it("reports that the API process is healthy", async () => {
    const response = await app.request("/health")

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("application/json")
    expect(await response.json()).toEqual({ status: "ok" })
  })
})

describe("minimal login surface", () => {
  it("offers login without exposing a sign-up control", async () => {
    const response = await app.request("/login")
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/html")
    expect(html).toContain('action="/login"')
    expect(html).toContain('name="password"')
    expect(html).not.toContain("sign-up/email")
  })

  it("preserves same-origin request context when adapting login to Better Auth", async () => {
    let forwardedHeaders = new Headers()
    const contextApp = createApp({
      auth: {
        handler: async (request) => {
          forwardedHeaders = request.headers
          return new Response(null, { headers: { "set-cookie": "session=active" } })
        },
        ownerId: async () => null,
      },
      security: {
        apiBodyBytes: 1_048_576,
        loginBodyBytes: 16_384,
        loginRateLimit: { attempts: 5, windowMs: 60_000 },
        trustedOrigins: ["http://studio.test"],
        trustProxy: false,
        uploadBodyBytes: 52_428_800,
      },
    })
    const form = new FormData()
    form.set("email", "owner@example.test")
    form.set("password", "correct horse battery staple")

    const response = await contextApp.request("http://studio.test/login", {
      body: form,
      headers: {
        cookie: "prior=context",
        origin: "http://studio.test",
        "user-agent": "origin-boundary-test",
      },
      method: "POST",
    })

    expect(response.status).toBe(303)
    expect(forwardedHeaders.get("origin")).toBe("http://studio.test")
    expect(forwardedHeaders.get("cookie")).toBe("prior=context")
    expect(forwardedHeaders.get("user-agent")).toBe("origin-boundary-test")
    expect(forwardedHeaders.get("content-type")).toBe("application/json")
  })
})

describe("built studio delivery", () => {
  const studio = createApp({
    auth: {
      handler: async () => new Response(null, { status: 404 }),
      ownerId: async (headers) => (headers.get("cookie") === "session=owner" ? "owner" : null),
    },
    studioAssets: {
      index:
        '<!doctype html><div id="root"></div><script type="module" src="/assets/studio.js"></script>',
      files: new Map([
        [
          "studio.js",
          { body: "document.title='Studio'", contentType: "text/javascript; charset=utf-8" },
        ],
      ]),
    },
    security: {
      apiBodyBytes: 1_048_576,
      loginBodyBytes: 16_384,
      loginRateLimit: { attempts: 5, windowMs: 60_000 },
      trustedOrigins: ["http://studio.test"],
      trustProxy: false,
      uploadBodyBytes: 52_428_800,
    },
  })

  it("serves the same React document after owner login and on an authoring deep link", async () => {
    const headers = { cookie: "session=owner" }
    const root = await studio.request("http://studio.test/", { headers })
    const deepLink = await studio.request("http://studio.test/briefs/study-1", { headers })
    expect(root.status).toBe(200)
    expect(await root.text()).toContain('<div id="root"></div>')
    expect(deepLink.status).toBe(200)
    expect(await deepLink.text()).toContain('src="/assets/studio.js"')
    expect(deepLink.headers.get("content-security-policy")).toContain("script-src 'self'")
  })

  it("denies anonymous authoring and does not expose legacy form responses", async () => {
    const anonymous = await studio.request("http://studio.test/briefs/study-1")
    const legacy = await studio.request("http://studio.test/briefs/study-1", {
      method: "POST",
      headers: {
        cookie: "session=owner",
        origin: "http://studio.test",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "action=approve&revisionId=forged",
    })
    expect(anonymous.status).toBe(401)
    expect(legacy.status).toBe(405)
  })

  it("serves only explicitly built assets and rejects traversal", async () => {
    const asset = await studio.request("http://studio.test/assets/studio.js")
    const missing = await studio.request("http://studio.test/assets/private.epub")
    expect(asset.status).toBe(200)
    expect(asset.headers.get("content-type")).toContain("text/javascript")
    expect(missing.status).toBe(404)
  })
})
