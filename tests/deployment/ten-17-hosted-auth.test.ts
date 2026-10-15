import { type ChildProcess, execFileSync, spawn } from "node:child_process"
import { once } from "node:events"
import { readFile } from "node:fs/promises"
import { request } from "node:http"
import { createServer } from "node:https"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { expect, it } from "vitest"
import { browserLogin, oldPassword, recoveryFixture } from "./ten-17-owner-recovery-fixture.ts"

it("preserves HTTPS hosted cookie and hostile-origin boundaries using owned host processes", async () => {
  const fixture = await recoveryFixture()
  const children: ChildProcess[] = []
  let publicOrigin = ""
  const key = join(fixture.fixture.directory, "fixture-key.pem")
  const certificate = join(fixture.fixture.directory, "fixture-cert.pem")
  execFileSync(
    "/usr/bin/openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      key,
      "-out",
      certificate,
      "-subj",
      "/CN=localhost",
      "-days",
      "1",
    ],
    { stdio: "ignore", timeout: 10_000 },
  )
  const api = `http://127.0.0.1:${fixture.environment["SERVER_PORT"]}`
  const proxy = createServer(
    { key: await readFile(key), cert: await readFile(certificate) },
    (incoming, response) => {
      const upstream = request(
        `${api}${incoming.url ?? "/"}`,
        {
          method: incoming.method,
          headers: {
            ...incoming.headers,
            host: new URL(api).host,
            "x-forwarded-host": new URL(publicOrigin).host,
            "x-forwarded-proto": "https",
          },
        },
        (result) => {
          response.writeHead(result.statusCode ?? 502, result.headers)
          result.pipe(response)
        },
      )
      upstream.on("error", () => {
        response.writeHead(502)
        response.end("Fixture upstream unavailable")
      })
      incoming.pipe(upstream)
    },
  )
  try {
    proxy.listen(0, "127.0.0.1")
    await once(proxy, "listening")
    const address = proxy.address()
    if (address === null || typeof address === "string")
      throw new TypeError("Fixture TLS binding missing")
    publicOrigin = `https://localhost:${address.port}`
    fixture.environment["AUTH_BASE_URL"] = publicOrigin
    fixture.environment["TRUSTED_ORIGINS"] = publicOrigin
    fixture.environment["TRUST_PROXY"] = "1"
    expect(fixture.tty()).toBe(0)
    execFileSync("bun", ["run", "--cwd", "apps/studio", "build"], {
      cwd: fixture.root,
      env: fixture.environment,
      stdio: "ignore",
      timeout: 30_000,
    })
    for (const entry of ["apps/server/src/index.ts", "apps/worker/src/index.ts"]) {
      children.push(
        spawn(process.execPath, ["--experimental-transform-types", entry], {
          cwd: fixture.root,
          env: fixture.environment,
          stdio: "ignore",
        }),
      )
    }
    const context = await fixture.context({ ignoreHTTPSErrors: true })
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      try {
        if ((await context.request.get(`${publicOrigin}/health`)).status() === 200) break
      } catch (error) {
        if (!(error instanceof Error)) throw error
      }
      await delay(100)
    }
    expect((await context.request.get(`${publicOrigin}/health`)).status()).toBe(200)
    expect(await browserLogin(context, publicOrigin, oldPassword)).toBe(303)
    expect((await context.request.get(`${publicOrigin}/api/library-context`)).status()).toBe(200)
    const sessions = (await context.cookies()).filter((cookie) => cookie.name.includes("session"))
    expect(sessions.length).toBeGreaterThan(0)
    expect(sessions.every((cookie) => cookie.secure && cookie.httpOnly)).toBe(true)
    const hostile = await context.request.post(`${publicOrigin}/logout`, {
      headers: { origin: "https://attacker.test" },
    })
    expect(hostile.status()).toBe(403)
    expect((await context.request.get(`${publicOrigin}/api/library-context`)).status()).toBe(200)
    const anonymous = await fixture.context({ ignoreHTTPSErrors: true })
    const rejection = await anonymous.request.post(`${publicOrigin}/login`, {
      headers: { origin: "https://attacker.test" },
      form: { email: "synthetic@example.test", password: "synthetic-only" },
    })
    expect(rejection.status()).toBe(403)
    expect(await anonymous.cookies()).toEqual([])
    for (const child of children) expect(child.exitCode).toBeNull()
  } finally {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        const closed = once(child, "close", { signal: AbortSignal.timeout(10_000) })
        child.kill("SIGTERM")
        await closed
      }
    }
    if (proxy.listening) await new Promise<void>((resolve) => proxy.close(() => resolve()))
    await fixture.close()
  }
}, 90_000)
