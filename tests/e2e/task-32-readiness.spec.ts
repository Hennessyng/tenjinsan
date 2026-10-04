import { execFileSync, spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { createServer } from "node:http"
import { connect, type Socket } from "node:net"
import { resolve } from "node:path"
import { type BrowserContext, chromium, expect, test } from "@playwright/test"
import { LocalLauncher, makeLocalFixture, removeLocalFixture } from "../deployment/local-fixture.ts"
import { syntheticEpub } from "./synthetic-epub.ts"

const root = resolve(import.meta.dirname, "../..")
const evidence = resolve(root, ".omo/evidence/reading-studio/task-32")

test("local owner login is ready at three widths and stops cleanly", async ({ page, browser }) => {
  test.setTimeout(180_000)
  // Given a disposable provisioned owner and private data root.
  const fixture = await makeLocalFixture(false)
  const owner = execFileSync(
    "expect",
    ["tests/deployment/owner-tty-fixture.exp", "bun", "run", "owner"],
    {
      cwd: root,
      env: fixture.environment,
      encoding: "utf8",
      timeout: 120_000,
    },
  )
  expect(owner).toBe("")
  const launcher = new LocalLauncher(fixture.environment)
  try {
    // When the documented launcher reports readiness.
    const ready = await launcher.ready()
    const health = await page.request.get(`${ready.apiUrl}/health`)
    expect(await health.json()).toEqual({ status: "ok" })
    for (const width of [375, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto(`${ready.apiUrl}/login`)
      // Then the owner login is usable at each width.
      await expect(page.getByRole("button", { name: "Log in" })).toBeVisible()
      await page.screenshot({ path: resolve(evidence, `local-login-${width}.png`), fullPage: true })
    }
    await page.getByLabel("Email").fill("owner@example.test")
    await page.getByLabel("Password").fill("correct horse battery staple")
    await page.getByRole("button", { name: "Log in" }).click()
    await expect(page.locator("#root")).toBeVisible()
    await expect(page.getByRole("heading", { name: "Import a book" })).toBeVisible()
    await expect(page.locator('script[type="module"][src^="/assets/"]')).toHaveCount(1)
    expect(
      (
        await page.request.post(`${ready.apiUrl}/briefs/missing`, {
          headers: { origin: ready.apiUrl },
          form: { action: "approve", revisionId: "forged" },
        })
      ).status(),
    ).toBe(405)
    await page.keyboard.press("Tab")
    await expect(page.getByRole("link", { name: /Skip to the studio/ })).toBeFocused()
    for (const width of [375, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto(`${ready.apiUrl}/`)
      await expect(page.getByRole("heading", { name: "Import a book" })).toBeVisible()
      await page.screenshot({
        path: resolve(evidence, `f1-b4-local-owner-${width}.png`),
        fullPage: true,
      })
      await page.goto(`${ready.apiUrl}/sources`)
      await expect(page.locator("#root")).toBeVisible()
      await expect(page.getByRole("heading", { name: "Your sources" })).toBeVisible()
      await page.reload()
      await expect(page.getByRole("heading", { name: "Your sources" })).toBeVisible()
    }
    await page.goto(`${ready.apiUrl}/imports`)
    await page.getByLabel("Choose EPUB").setInputFiles({
      name: "synthetic.epub",
      mimeType: "application/epub+zip",
      buffer: await syntheticEpub(),
    })
    await page.getByRole("button", { name: "Import EPUB" }).click()
    await expect(page.getByRole("status")).toContainText("Import accepted")
    await page.getByRole("link", { name: "View your sources" }).click()
    await page.getByRole("link", { name: "Imported EPUB" }).click()
    await expect(page.getByRole("heading", { name: "Imported EPUB" })).toBeVisible()
    await page.getByRole("link", { name: "Set up a study" }).click()
    await expect(page.getByRole("heading", { name: "Set up a study" })).toBeVisible()
    const noScript = await browser.newContext({ javaScriptEnabled: false })
    try {
      const anonymous = await noScript.request.get(`${ready.apiUrl}/sources`)
      expect(anonymous.status()).toBe(401)
      const fallback = await noScript.newPage()
      await fallback.goto(`${ready.apiUrl}/login`)
      await fallback.getByLabel("Email").fill("owner@example.test")
      await fallback.getByLabel("Password").fill("correct horse battery staple")
      await fallback.getByRole("button", { name: "Log in" }).click()
      await expect(
        fallback.getByRole("heading", { name: "Reading studio needs JavaScript for authoring" }),
      ).toBeVisible()
      expect(
        (
          await fallback
            .getByRole("heading", { name: "Reading studio needs JavaScript for authoring" })
            .boundingBox()
        )?.y,
      ).toBeGreaterThanOrEqual(24)
      await expect(fallback.locator("#root")).toBeEmpty()
      await fallback.screenshot({
        path: resolve(evidence, "f1-b4-local-noscript.png"),
        fullPage: true,
      })
    } finally {
      await noScript.close()
    }
    await launcher.stop(ready.launcherPid)
    expect(launcher.output).toContain('"event":"local-stopped"')
  } finally {
    launcher.forceStop()
    await removeLocalFixture(fixture)
  }
})

test("isolated Compose login is ready through local-CA HTTPS", async () => {
  test.setTimeout(360_000)
  const project = `task32-${randomUUID().slice(0, 8)}`
  const environment = {
    ...process.env,
    CANONICAL_ORIGIN: "https://localhost",
    AUTH_SECRET: "synthetic-only-task32-secret-longer-than-32-characters",
    PROXY_BIND: "127.0.0.1",
    HTTP_PORT: "0",
    HTTPS_PORT: "0",
  }
  const args = [
    "compose",
    "-p",
    project,
    "-f",
    "deploy/compose.yml",
    "-f",
    "tests/deployment/compose-synthetic.yml",
  ]
  const compose = (command: readonly string[]): string =>
    execFileSync("docker", [...args, ...command], {
      cwd: root,
      env: environment,
      encoding: "utf8",
      timeout: 600_000,
    }).trim()
  const sockets = new Set<Socket>()
  const tunnel = createServer()
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  let context: BrowserContext | undefined
  try {
    // Given an isolated Compose project with synthetic, non-public credentials.
    compose(["config", "--quiet"])
    compose(["build"])
    const provision = spawnSync(
      "expect",
      [
        "tests/deployment/owner-tty-fixture.exp",
        "docker",
        ...args,
        "run",
        "--rm",
        "--no-deps",
        "api",
        "node",
        "--experimental-transform-types",
        "scripts/owner.ts",
      ],
      { cwd: root, env: environment, timeout: 120_000, encoding: "utf8" },
    )
    if (provision.status !== 0)
      throw new Error(
        `Owner fixture failed (${provision.status ?? provision.signal}): ${provision.stdout} ${provision.stderr} ${provision.error?.message ?? ""}`,
      )
    // When the documented proxy stack reaches healthy status.
    compose(["up", "-d", "--wait", "--wait-timeout", "120"])
    const binding = compose(["port", "proxy", "443"])
    const port = Number(binding.split(":").at(-1))
    expect(Number.isInteger(port)).toBe(true)
    tunnel.on("connection", (socket) => {
      sockets.add(socket)
      socket.on("close", () => sockets.delete(socket))
    })
    tunnel.on("connect", (request, client, head) => {
      if (request.url !== "localhost:443") {
        client.end("HTTP/1.1 403 Forbidden\r\n\r\n")
        return
      }
      const upstream = connect(port, "127.0.0.1", () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n")
        if (head.length > 0) upstream.write(head)
        client.pipe(upstream)
        upstream.pipe(client)
      })
      sockets.add(upstream)
      upstream.on("close", () => sockets.delete(upstream))
      client.on("error", () => upstream.destroy())
      upstream.on("error", () => client.destroy())
    })
    tunnel.listen(0, "127.0.0.1")
    await new Promise<void>((resolveReady, rejectReady) => {
      tunnel.once("listening", resolveReady)
      tunnel.once("error", rejectReady)
    })
    const address = tunnel.address()
    if (!address || typeof address === "string") throw new TypeError("No test tunnel port")
    browser = await chromium.launch({ args: ["--proxy-bypass-list=<-loopback>"] })
    context = await browser.newContext({
      ignoreHTTPSErrors: true,
      proxy: { server: `http://127.0.0.1:${address.port}` },
    })
    const page = await context.newPage()
    const health = await page.request.get("https://localhost/health")
    expect(await health.json()).toEqual({ status: "ok" })
    for (const width of [375, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto("https://localhost/login")
      // Then login is rendered through the HTTPS proxy.
      await expect(page.getByRole("button", { name: "Log in" })).toBeVisible()
      await page.screenshot({
        path: resolve(evidence, `compose-login-${width}.png`),
        fullPage: true,
      })
    }
    await page.getByLabel("Email").fill("owner@example.test")
    await page.getByLabel("Password").fill("correct horse battery staple")
    await page.getByRole("button", { name: "Log in" }).click()
    await expect(page.locator("#root")).toBeVisible()
    await expect(page.getByRole("heading", { name: "Import a book" })).toBeVisible()
    expect(
      (
        await page.request.post("https://localhost/briefs/missing", {
          headers: { origin: "https://localhost" },
          form: { action: "approve", revisionId: "forged" },
        })
      ).status(),
    ).toBe(405)
    for (const width of [375, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto("https://localhost/")
      await expect(page.getByRole("heading", { name: "Import a book" })).toBeVisible()
      await page.screenshot({
        path: resolve(evidence, `f1-b4-compose-owner-${width}.png`),
        fullPage: true,
      })
      await page.goto("https://localhost/sources")
      await expect(page.getByRole("heading", { name: "Your sources" })).toBeVisible()
      await page.reload()
      await expect(page.getByRole("heading", { name: "Your sources" })).toBeVisible()
    }
    const noScript = await browser.newContext({
      ignoreHTTPSErrors: true,
      proxy: { server: `http://127.0.0.1:${address.port}` },
      javaScriptEnabled: false,
    })
    try {
      expect((await noScript.request.get("https://localhost/sources")).status()).toBe(401)
      await noScript.addCookies(await context.cookies())
      const fallback = await noScript.newPage()
      await fallback.goto("https://localhost/")
      await expect(
        fallback.getByRole("heading", { name: "Reading studio needs JavaScript for authoring" }),
      ).toBeVisible()
      expect(
        (
          await fallback
            .getByRole("heading", { name: "Reading studio needs JavaScript for authoring" })
            .boundingBox()
        )?.y,
      ).toBeGreaterThanOrEqual(24)
      await fallback.screenshot({
        path: resolve(evidence, "f1-b4-compose-noscript.png"),
        fullPage: true,
      })
    } finally {
      await noScript.close()
    }
    expect(compose(["ps", "--format", "json"])).toContain('"Service":"proxy"')
  } catch (error) {
    process.stderr.write(`${compose(["logs", "--no-color", "--tail", "20", "api"])}\n`)
    throw error
  } finally {
    await context?.close()
    await browser?.close()
    for (const socket of sockets) socket.destroy()
    if (tunnel.listening) {
      await new Promise<void>((resolveClose) => tunnel.close(() => resolveClose()))
    }
    compose(["down", "--volumes", "--remove-orphans"])
  }
})
