import { execFileSync } from "node:child_process"
import { once } from "node:events"
import { mkdir, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { resolve } from "node:path"
import { getRequestListener } from "@hono/node-server"
import { chromium, expect as visible } from "@playwright/test"
import { Hono } from "hono"
import { expect, it } from "vitest"
import type { AppEnvironment } from "../../apps/server/src/middleware/access.ts"
import { configureStudioAssets, loadStudioAssets } from "../../apps/server/src/studio-assets.ts"
import { publicationFixture } from "../../apps/server/src/testing/publication-fixture.ts"

it("TEN-12 AC2 keeps real loading readable until held responses complete", async () => {
  execFileSync("bun", ["run", "--cwd", "apps/studio", "build"], { stdio: "pipe" })
  const fixture = await publicationFixture()
  const app = new Hono<AppEnvironment>()
  let release = () => {}
  let held = Promise.resolve()
  let holdChunks = false
  app.use("*", async (context, next) => {
    if (
      context.req.path.startsWith("/api/") ||
      (holdChunks && /Routes.*\.js$/.test(context.req.path))
    )
      await held
    return next()
  })
  configureStudioAssets(
    app,
    loadStudioAssets(resolve("apps/studio/dist")),
    async () => "fixture-owner",
  )
  app.all("*", async (context) => {
    const url = new URL(context.req.url)
    const headers = new Headers(context.req.raw.headers)
    if (headers.has("origin")) headers.set("origin", fixture.origin)
    const response = await fetch(`${fixture.origin}${url.pathname}${url.search}`, {
      method: context.req.method,
      headers,
      redirect: "manual",
      ...(context.req.method === "GET" ? {} : { body: await context.req.arrayBuffer() }),
    })
    const result = new Headers(response.headers)
    const location = result.get("location")
    if (location?.startsWith(fixture.origin))
      result.set("location", location.slice(fixture.origin.length))
    return new Response(response.body, { status: response.status, headers: result })
  })
  const server = createServer(getRequestListener(app.fetch))
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  if (!address || typeof address === "string") throw new TypeError("Missing fixture address")
  const origin = `http://127.0.0.1:${address.port}`
  const browser = await chromium.launch()
  const directory =
    ".sisyphus/runs/ten-12-apply-the-identity-across-the-workspace/evidence/loading-chromium"
  await mkdir(directory, { recursive: true })
  const analysis = fixture.storage.workflow.getAnalysis(fixture.definition.analysisRevisionId)
  if (!analysis) throw new TypeError("Missing analysis")
  const source = analysis.cacheInput.normalizationRevisionId
  const study = fixture.lesson.studyId
  const routes = [
    "/sources",
    `/sources/${source}`,
    `/sources/${source}/setup`,
    `/sources/${source}/setup/${fixture.lesson.setupRevisionId}`,
    "/interviews",
    `/interviews/${study}`,
    `/briefs/${study}`,
    `/outlines/${study}`,
    "/jobs",
    `/evidence/${study}`,
    `/publications/${study}`,
    `/revisions/${study}`,
  ]
  const rows: { path: string; width: number; paper: string; bounded: boolean }[] = []
  try {
    const page = await browser.newPage()
    await page.goto(`${origin}/login`)
    await page.getByLabel("Email").fill(fixture.credentials.email)
    await page.getByLabel("Password").fill(fixture.credentials.password)
    await page.getByRole("button", { name: "Log in" }).click()
    await page.waitForURL(`${origin}/`)
    for (const width of [375, 768, 1280]) {
      await page.setViewportSize({ width, height: 700 })
      for (const path of routes) {
        held = new Promise<void>((done) => {
          release = done
        })
        await page.goto(`${origin}${path}`)
        const loading = page.getByRole("status").filter({ hasText: /^Loading/ })
        await visible(loading).toBeVisible()
        rows.push({
          path,
          width,
          paper: await loading.evaluate((node) => getComputedStyle(node).backgroundColor),
          bounded: await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        })
        await page.screenshot({ path: `${directory}/${width}-${routes.indexOf(path)}.png` })
        release()
        await visible(loading).toHaveCount(0)
        await visible(page.locator("main")).toBeVisible()
      }
    }
    const lazyPage = await browser.newPage()
    await lazyPage.context().addCookies(await page.context().cookies())
    holdChunks = true
    held = new Promise<void>((done) => {
      release = done
    })
    await lazyPage.goto(`${origin}/jobs`, { waitUntil: "domcontentloaded" })
    const lazy = lazyPage.getByRole("status").filter({ hasText: "Loading studio" })
    await visible(lazy).toBeVisible()
    rows.push({
      path: "lazy /jobs",
      width: 1280,
      paper: await lazy.evaluate((node) => getComputedStyle(node).backgroundColor),
      bounded: true,
    })
    release()
    await visible(lazy).toHaveCount(0)
    await page.goto(`${origin}/imports`)
    await page.getByLabel("Choose EPUB").setInputFiles({
      name: "synthetic.epub",
      mimeType: "application/epub+zip",
      buffer: Buffer.from("invalid synthetic fixture"),
    })
    held = new Promise<void>((done) => {
      release = done
    })
    await page.getByRole("button", { name: "Import EPUB", exact: true }).click()
    const busy = page.getByRole("button", { name: "Importing…" })
    await visible(busy).toBeDisabled()
    const busyPaper = await busy.evaluate((node) => getComputedStyle(node).backgroundColor)
    release()
    await visible(page.getByRole("alert")).toContainText("Import refused")
    await writeFile(
      `${directory}/receipt.json`,
      JSON.stringify({
        rows,
        busyPaper,
        inapplicable: ["/login and owner fallback: no client loading", "/: static hall"],
        waiver: "Safari waived by user; Chromium only.",
      }),
    )
    expect(rows.filter((row) => row.paper !== "rgb(255, 253, 248)" || !row.bounded)).toEqual([])
    expect(busyPaper).toBe("rgb(255, 253, 248)")
  } finally {
    release()
    await browser.close()
    await new Promise<void>((done) => server.close(() => done()))
    await fixture.close()
  }
}, 180_000)
