import { execFileSync } from "node:child_process"
import { DatabaseSync } from "node:sqlite"
import { chromium, errors, expect as visible } from "@playwright/test"
import { expect, it } from "vitest"
import { z } from "zod"
import { LocalLauncher, makeLocalFixture, removeLocalFixture } from "../deployment/local-fixture.ts"
import { syntheticEpub } from "../e2e/synthetic-epub.ts"

it("TEN-16 S5 T7 recovers real expired sessions without protected content or mutation replay", async () => {
  execFileSync("bun", ["run", "--cwd", "apps/studio", "build"], { stdio: "pipe" })
  const fixture = await makeLocalFixture(true)
  const environment = { ...fixture.environment }
  delete environment["STUDIO_SYNTHETIC_TEST_MODE"]
  const launcher = new LocalLauncher(environment)
  const browser = await chromium.launch()
  try {
    const ready = await launcher.ready()
    const origin = ready.apiUrl
    const page = await browser.newPage()
    const signIn = async () => {
      await page.getByLabel("Email").fill("owner@example.test")
      await page.getByLabel("Password").fill("correct horse battery staple")
      await page.getByRole("button", { name: "Log in", exact: true }).click()
      await page.waitForURL(`${origin}/`)
      await page
        .getByRole("status", { name: "Entering the library" })
        .waitFor({ state: "detached" })
      await visible(page.locator("#desk")).toHaveCount(0)
    }
    const expire = () => {
      const path = z.string().parse(environment["DATABASE_PATH"])
      const database = new DatabaseSync(path)
      try {
        const result = database
          .prepare("UPDATE auth_sessions SET expires_at = 0 WHERE expires_at > ?")
          .run(Date.now())
        expect(Number(result.changes)).toBeGreaterThan(0)
      } finally {
        database.close()
      }
    }
    const open = (name: string) =>
      page
        .getByRole("navigation", { name: "Reading route / 読書ルート" })
        .getByRole("button", { name: new RegExp(name) })
        .click()
    await page.goto(`${origin}/login`)
    await signIn()
    expect((await page.request.get(`${origin}/api/source-library`)).status()).toBe(200)
    expire()
    const loss = page.waitForResponse(
      (response) => response.url().endsWith("/api/library-context") && response.status() === 401,
    )
    await open("Import & read")
    await loss
    await visible(page.getByRole("heading", { name: /Authentication required/ })).toBeVisible()
    await visible(page.getByLabel("Choose EPUB")).toHaveCount(0)
    await visible(page.getByRole("link", { name: /Sign in/ })).toHaveAttribute("href", "/login")
    await page.getByRole("link", { name: /Sign in/ }).click()
    await signIn()
    await page.goto(`${origin}/sources/absent`)
    await visible(
      page.getByRole("heading", { name: "Missing reference", exact: true }),
    ).toBeVisible()
    await visible(page.getByRole("heading", { name: /Authentication required/ })).toHaveCount(0)
    expire()
    const denied = await page.goto(`${origin}/sources`)
    expect(denied?.status()).toBe(401)
    await visible(page.getByRole("heading", { name: /Authentication required/ })).toBeVisible()
    await visible(page.locator("#reading")).toHaveCount(0)
    expect((await page.request.get(`${origin}/api/source-library`)).status()).toBe(401)
    await page.getByRole("link", { name: /Sign in/ }).click()
    await signIn()
    await open("Bindery")
    await visible(page.getByRole("heading", { name: /Study progress/ })).toBeVisible()
    expire()
    await page.waitForResponse(
      (response) => response.url().endsWith("/api/study-jobs") && response.status() === 401,
    )
    await visible(page.getByRole("heading", { name: /Authentication required/ })).toBeVisible()
    const continued = await page
      .waitForResponse((response) => response.url().endsWith("/api/study-jobs"), { timeout: 3500 })
      .then(
        () => true,
        (error: unknown) => {
          if (error instanceof errors.TimeoutError) return false
          throw error
        },
      )
    expect(continued).toBe(false)
    await page.getByRole("link", { name: /Sign in/ }).click()
    await signIn()
    await open("Import & read")
    await page.getByLabel("Choose EPUB").setInputFiles({
      name: "synthetic.epub",
      mimeType: "application/epub+zip",
      buffer: await syntheticEpub(),
    })
    expire()
    const uploads: string[] = []
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().endsWith("/api/imports/upload"))
        uploads.push(request.url())
    })
    const refused = page.waitForResponse(
      (response) => response.url().endsWith("/api/imports/upload") && response.status() === 401,
    )
    await page.getByRole("button", { name: "Import EPUB", exact: true }).click()
    await refused
    await visible(page.getByRole("heading", { name: /Authentication required/ })).toBeVisible()
    await visible(page.getByRole("dialog", { name: /Unsaved changes/ })).toHaveCount(0)
    await page.getByRole("link", { name: /Sign in/ }).click()
    await signIn()
    expect(uploads).toHaveLength(1)
    expect(
      (
        await page.request.get(`${origin}/publication-artifacts/absent`, {
          headers: { cookie: "" },
        })
      ).status(),
    ).toBe(401)
  } finally {
    launcher.forceStop()
    await launcher.waitForExit()
    await browser.close()
    await removeLocalFixture(fixture)
  }
}, 300_000)
