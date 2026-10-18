import { once } from "node:events"
import { createServer } from "node:http"
import { dirname, resolve } from "node:path"
import { sourceViewerFixture } from "@reading-studio/server/source-viewer-fixture"
import { createServer as createViteServer } from "vite"
import { afterEach, expect, it, vi } from "vitest"

afterEach(() => vi.unstubAllEnvs())

it("opens the anonymous library through studio proxy while retaining origin isolation", async () => {
  const fixture = await sourceViewerFixture()
  const http = createServer()
  let studio: Awaited<ReturnType<typeof createViteServer>> | undefined
  try {
    http.listen(0, "127.0.0.1")
    await once(http, "listening")
    const address = http.address()
    if (!address || typeof address === "string") throw new TypeError("Missing owned studio port")
    const origin = `http://127.0.0.1:${address.port}`
    vi.stubEnv("SERVER_PORT", new URL(fixture.origin).port)
    vi.stubEnv("STUDIO_PORT", String(address.port))
    studio = await createViteServer({
      root: resolve("apps/studio"),
      envDir: dirname(fixture.databasePath),
      server: { middlewareMode: true },
      logLevel: "silent",
    })
    http.on("request", studio.middlewares)
    const library = await fetch(origin + "/api/library-context")
    expect(library.status).toBe(200)
    expect(library.headers.get("set-cookie")).toBeNull()
    const legacy = await fetch(origin + "/login", { redirect: "manual" })
    expect(legacy.status).toBe(303)
    expect(legacy.headers.get("location")).toBe("/")
    expect(legacy.headers.get("set-cookie")).toBeNull()
    const hostile = await fetch(origin + "/api/library-selection", {
      method: "POST",
      headers: { origin: "https://attacker.invalid", "content-type": "application/json" },
      body: JSON.stringify({ studyId: "study-fixture" }),
    })
    expect(hostile.status).toBe(403)
    const selected = await fetch(origin + "/api/library-selection", {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ studyId: "study-fixture" }),
    })
    expect(selected.status).toBe(200)
    expect(
      selected.headers.getSetCookie().some((cookie) => cookie.startsWith("better-auth.")),
    ).toBe(false)
    expect((await fetch(origin + "/api/library-context")).status).toBe(200)
  } finally {
    await studio?.close()
    if (http.listening)
      await new Promise<void>((done, reject) =>
        http.close((error) => (error ? reject(error) : done())),
      )
    await fixture.close()
  }
}, 30000)
