import { once } from "node:events"
import { mkdtemp, rm } from "node:fs/promises"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { serve } from "@hono/node-server"
import { type Browser, chromium } from "@playwright/test"
import { openAuthStorage } from "@reading-studio/storage"
import { Hono } from "hono"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createApp } from "../app.ts"
import { createOwnerAuth, createServerAuth } from "./auth.ts"
import { createOwnerService } from "./owner.ts"

const SECRET = "origin-test-secret-with-at-least-thirty-two-characters"
const EMAIL = "owner@example.test"
const PASSWORD = "correct horse battery staple"

type LiveHarness = {
  readonly attackerOrigin: string
  readonly close: () => Promise<void>
  readonly origin: string
}

let browser: Browser | undefined

beforeAll(async () => {
  browser = await chromium.launch()
})

afterAll(async () => {
  await browser?.close()
})

function activeBrowser(): Browser {
  if (browser === undefined) {
    throw new TypeError("Playwright browser did not start")
  }
  return browser
}

async function availablePort(): Promise<number> {
  const server = createServer()
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error === undefined) {
        resolveClose()
      } else {
        rejectClose(error)
      }
    })
  })
  if (address === null || typeof address === "string") {
    throw new TypeError("Unable to allocate an HTTP test port")
  }
  return address.port
}

async function closeServer(server: ReturnType<typeof serve>): Promise<void> {
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error === undefined) {
        resolveClose()
      } else {
        rejectClose(error)
      }
    })
  })
}

async function createLiveHarness(): Promise<LiveHarness> {
  const directory = await mkdtemp(join(tmpdir(), "reading-studio-origin-"))
  const port = await availablePort()
  const origin = `http://127.0.0.1:${port}`
  const storage = openAuthStorage(join(directory, "studio.sqlite"))
  const config = { baseURL: origin, secret: SECRET, sessionExpiresIn: 60 * 60 }
  const ownerAuth = createOwnerAuth(storage, config)
  await createOwnerService(storage, ownerAuth).provision({
    email: EMAIL,
    name: "Studio Owner",
    password: PASSWORD,
  })
  const serverAuth = createServerAuth(storage, config)
  const app = createApp({
    auth: {
      handler: serverAuth.handler,
      ownerId: async (headers) => (await serverAuth.api.getSession({ headers }))?.user.id ?? null,
    },
    security: {
      apiBodyBytes: 1_048_576,
      loginBodyBytes: 16_384,
      loginRateLimit: { attempts: 20, windowMs: 60_000 },
      trustedOrigins: [origin],
      trustProxy: false,
      uploadBodyBytes: 52_428_800,
    },
  })
  const targetServer = serve({ fetch: app.fetch, hostname: "127.0.0.1", port })
  if (!targetServer.listening) {
    await once(targetServer, "listening")
  }

  const attacker = new Hono()
  attacker.get("/login", (context) =>
    context.html(
      `<form action="${origin}/login" method="post"><input name="email" value="${EMAIL}"><input name="password" value="${PASSWORD}"><button type="submit">Cross-origin login</button></form>`,
    ),
  )
  attacker.get("/logout", (context) =>
    context.html(
      `<form action="${origin}/logout" method="post"><button type="submit">Cross-origin logout</button></form>`,
    ),
  )
  const attackerServer = serve({ fetch: attacker.fetch, hostname: "127.0.0.1", port: 0 })
  if (!attackerServer.listening) {
    await once(attackerServer, "listening")
  }
  const attackerAddress = attackerServer.address()
  if (attackerAddress === null || typeof attackerAddress === "string") {
    throw new TypeError("Unable to read the hostile-origin test server address")
  }
  const attackerOrigin = `http://127.0.0.1:${attackerAddress.port}`

  return {
    attackerOrigin,
    origin,
    close: async () => {
      await closeServer(attackerServer)
      await closeServer(targetServer)
      storage.close()
      await rm(directory, { recursive: true })
    },
  }
}

function sessionValues(
  cookies: readonly { readonly name: string; readonly value: string }[],
): string[] {
  return cookies
    .filter((cookie) => cookie.name.includes("session_token") && cookie.value !== "")
    .map((cookie) => cookie.value)
}

describe("owner form Origin boundary", () => {
  it("rejects cross-origin login without creating a session or mutating cookies", async () => {
    const harness = await createLiveHarness()
    const context = await activeBrowser().newContext()
    try {
      const page = await context.newPage()
      await page.goto(`${harness.attackerOrigin}/login`)
      const responsePromise = page.waitForResponse(
        (response) =>
          response.url() === `${harness.origin}/login` && response.request().method() === "POST",
      )

      await page.getByRole("button", { name: "Cross-origin login" }).click()
      const response = await responsePromise

      expect(response.status()).toBe(403)
      expect(sessionValues(await context.cookies(harness.origin))).toEqual([])
      expect(
        await (await context.request.get(`${harness.origin}/api/auth/get-session`)).json(),
      ).toBeNull()
    } finally {
      await context.close()
      await harness.close()
    }
  })

  it("rejects cross-origin logout without revoking or replacing the session cookie", async () => {
    const harness = await createLiveHarness()
    const context = await activeBrowser().newContext()
    try {
      const page = await context.newPage()
      await page.goto(`${harness.origin}/login`)
      await page.getByLabel("Email").fill(EMAIL)
      await page.getByLabel("Password").fill(PASSWORD)
      await page.getByRole("button", { name: "Log in" }).click()
      await page.locator('[data-authenticated="true"]').waitFor()
      const cookieBefore = sessionValues(await context.cookies(harness.origin))
      await page.goto(`${harness.attackerOrigin}/logout`)
      const responsePromise = page.waitForResponse(
        (response) =>
          response.url() === `${harness.origin}/logout` && response.request().method() === "POST",
      )

      await page.getByRole("button", { name: "Cross-origin logout" }).click()
      const response = await responsePromise

      expect(response.status()).toBe(403)
      expect(sessionValues(await context.cookies(harness.origin))).toEqual(cookieBefore)
      await page.goto(harness.origin)
      await expect(page.locator('[data-authenticated="true"]').isVisible()).resolves.toBe(true)
    } finally {
      await context.close()
      await harness.close()
    }
  })

  it("keeps same-origin login and logout operational", async () => {
    const harness = await createLiveHarness()
    const context = await activeBrowser().newContext()
    try {
      const page = await context.newPage()
      await page.goto(`${harness.origin}/login`)
      await page.getByLabel("Email").fill(EMAIL)
      await page.getByLabel("Password").fill(PASSWORD)
      await page.getByRole("button", { name: "Log in" }).click()
      await page.locator('[data-authenticated="true"]').waitFor()

      expect(sessionValues(await context.cookies(harness.origin))).toHaveLength(1)
      await page.getByRole("button", { name: "Log out" }).click()
      await page.getByRole("heading", { name: "Owner login" }).waitFor()
      expect(sessionValues(await context.cookies(harness.origin))).toEqual([])
    } finally {
      await context.close()
      await harness.close()
    }
  })

  it("rejects a malformed cross-origin login before body parsing", async () => {
    const harness = await createLiveHarness()
    try {
      const response = await fetch(`${harness.origin}/login`, {
        body: "malformed multipart body",
        headers: {
          "content-type": "multipart/form-data; boundary=invalid",
          origin: harness.attackerOrigin,
        },
        method: "POST",
        redirect: "manual",
      })

      expect(response.status).toBe(403)
      expect(response.headers.get("set-cookie")).toBeNull()
    } finally {
      await harness.close()
    }
  })
})
