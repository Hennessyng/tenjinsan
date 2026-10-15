import { once } from "node:events"
import { createServer } from "node:http"
import { resolve } from "node:path"
import { sourceViewerFixture } from "@reading-studio/server/source-viewer-fixture"
import { openAuthStorage } from "@reading-studio/storage"
import { createServer as createViteServer } from "vite"
import { afterEach, expect, it, vi } from "vitest"

afterEach(() => vi.unstubAllEnvs())

it("allows a new owner login through the studio after a session expires", async () => {
  // Given a real disposable owner and API, with an isolated studio listener.
  const fixture = await sourceViewerFixture()
  const http = createServer()
  let studio: Awaited<ReturnType<typeof createViteServer>> | undefined
  try {
    http.listen(0, "127.0.0.1")
    await once(http, "listening")
    const address = http.address()
    if (address === null || typeof address === "string") throw new TypeError("Missing studio port")
    const origin = `http://127.0.0.1:${address.port}`
    vi.stubEnv("SERVER_PORT", new URL(fixture.origin).port)
    vi.stubEnv("STUDIO_PORT", String(address.port))
    studio = await createViteServer({
      root: resolve("apps/studio"),
      server: { middlewareMode: true },
      logLevel: "silent",
    })
    http.on("request", studio.middlewares)
    const postLogin = (target: string, requestOrigin: string, cookie?: string) =>
      fetch(`${target}/login`, {
        method: "POST",
        redirect: "manual",
        headers: { origin: requestOrigin, ...(cookie === undefined ? {} : { cookie }) },
        body: new URLSearchParams(fixture.credentials),
      })
    const cookieFrom = (response: Response) => {
      const cookie = response.headers
        .getSetCookie()
        .find((value) => value.startsWith("better-auth.session_token="))
        ?.split(";")[0]
      if (cookie === undefined) throw new TypeError("Missing session cookie")
      return cookie
    }
    const initial = await postLogin(fixture.origin, fixture.origin)
    expect(initial.status).toBe(303)
    const cookie = cookieFrom(initial)
    const storage = openAuthStorage(fixture.databasePath)
    try {
      storage.sqlite.prepare("UPDATE auth_sessions SET expires_at = ?").run(Date.now() - 1000)
    } finally {
      storage.close()
    }
    expect((await fetch(`${origin}/api/library-context`, { headers: { cookie } })).status).toBe(401)

    // When the expired owner follows Sign in and submits valid credentials.
    const entrance = await fetch(`${origin}/login`, {
      redirect: "manual",
      headers: { cookie },
    })
    expect(entrance.status).toBe(200)
    expect(await entrance.text()).toContain('name="password"')
    const login = await postLogin(origin, origin, cookie)

    // Then a new session grants access, and hostile origins remain rejected.
    expect(login.status).toBe(303)
    expect(login.headers.get("location")).toBe("/")
    const freshCookie = cookieFrom(login)
    expect(freshCookie).not.toBe(cookie)
    const hall = await fetch(new URL(login.headers.get("location") ?? "/", fixture.origin), {
      redirect: "manual",
      headers: { cookie: freshCookie },
    })
    expect(hall.status).toBe(200)
    expect(await hall.text()).toContain('data-authenticated="true"')
    expect(
      (await fetch(`${origin}/api/library-context`, { headers: { cookie: freshCookie } })).status,
    ).toBe(200)
    expect(
      (
        await fetch(`${origin}/logout`, {
          method: "POST",
          redirect: "manual",
          headers: { origin: "http://attacker.invalid", cookie: freshCookie },
        })
      ).status,
    ).toBe(403)
    const logout = await fetch(`${origin}/logout`, {
      method: "POST",
      redirect: "manual",
      headers: { origin, cookie: freshCookie },
    })
    expect(logout.status).toBe(303)
    expect(
      (await fetch(`${origin}/api/library-context`, { headers: { cookie: freshCookie } })).status,
    ).toBe(401)
    expect((await fetch(`${origin}/entrance-decoration.js`)).headers.get("content-type")).toContain(
      "javascript",
    )
    expect((await postLogin(origin, "http://attacker.invalid")).status).toBe(403)
  } finally {
    await studio?.close()
    if (http.listening)
      await new Promise<void>((done, reject) =>
        http.close((error) => (error ? reject(error) : done())),
      )
    await fixture.close()
  }
}, 30000)
