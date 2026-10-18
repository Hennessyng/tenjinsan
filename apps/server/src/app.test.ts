import { describe, expect, it } from "vitest"
import { createApp } from "./app"

const app = createApp({
  libraryOwnerId: "library-owner",
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
    apiBodyBytes: 1024,
    loginBodyBytes: 1024,
    uploadBodyBytes: 8192,
    loginRateLimit: { attempts: 5, windowMs: 60000 },
    trustedOrigins: ["http://studio.test"],
    trustProxy: false,
  },
})

describe("open library HTTP surface", () => {
  it("reports health without a session", async () => {
    const response = await app.request("http://studio.test/health")
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: "ok" })
  })
  it.each(["/", "/sources", "/briefs/study-1", "/jobs", "/imports"])(
    "serves the React library at %s anonymously",
    async (path) => {
      const response = await app.request("http://studio.test" + path)
      expect(response.status).toBe(200)
      expect(response.headers.get("set-cookie")).toBeNull()
      expect(await response.text()).toContain('id="root"')
      expect(response.headers.get("content-security-policy")).toContain("script-src 'self'")
    },
  )
  it.each(["/login", "/logout"])(
    "redirects retired %s to the app, not a credential form",
    async (path) => {
      const response = await app.request("http://studio.test" + path)
      expect(response.status).toBe(303)
      expect(response.headers.get("location")).toBe("/")
      expect(response.headers.get("set-cookie")).toBeNull()
    },
  )
  it("does not restore legacy authoring form responses", async () => {
    const response = await app.request("http://studio.test/briefs/study-1", {
      method: "POST",
      headers: {
        origin: "http://studio.test",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "action=approve&revisionId=forged",
    })
    expect(response.status).toBe(405)
  })
  it("serves only built assets and never exposes private files", async () => {
    expect((await app.request("http://studio.test/assets/studio.js")).status).toBe(200)
    for (const path of [
      "/assets/private.epub",
      "/data/studio.sqlite",
      "/data/private/original.epub",
      "/private/auth.json",
    ])
      expect((await app.request("http://studio.test" + path)).status).toBe(404)
  })
})
