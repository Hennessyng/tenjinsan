import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { once } from "node:events"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { resolve } from "node:path"
import { getRequestListener } from "@hono/node-server"
import { expect as browserExpect, chromium } from "@playwright/test"
import { Hono } from "hono"
import { expect, it } from "vitest"
import type { AppEnvironment } from "../../apps/server/src/middleware/access.ts"
import {
  configureStudioAssets,
  loadStudioAssets,
  studioResponse,
} from "../../apps/server/src/studio-assets.ts"
import { publicationFixture } from "../../apps/server/src/testing/publication-fixture.ts"

it("TEN-12 AC1 presents existing normal routes as a private library", async () => {
  execFileSync("bun", ["run", "--cwd", "apps/studio", "build"], { stdio: "pipe" })
  const fixture = await publicationFixture()
  const assets = loadStudioAssets(resolve("apps/studio/dist"))
  const app = new Hono<AppEnvironment>()
  const ownerId = async (headers: Headers) => {
    const response = await fetch(`${fixture.origin}/api/source-library`, { headers })
    return response.ok ? "fixture-owner" : null
  }
  configureStudioAssets(app, assets, ownerId)
  app.get("/", async (context) => {
    if (context.req.query("fallback") === "1")
      return fetch(`${fixture.origin}/`, { headers: context.req.raw.headers, redirect: "manual" })
    if ((await ownerId(context.req.raw.headers)) === null) return context.redirect("/login")
    return studioResponse(context, assets)
  })
  app.all("*", async (context) => {
    const url = new URL(context.req.url)
    const headers = new Headers(context.req.raw.headers)
    if (headers.has("origin")) headers.set("origin", fixture.origin)
    const response = await fetch(`${fixture.origin}${url.pathname}${url.search}`, {
      method: context.req.method,
      headers,
      ...(context.req.method === "GET" || context.req.method === "HEAD"
        ? {}
        : { body: await context.req.arrayBuffer() }),
      redirect: "manual",
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
    ".sisyphus/runs/ten-12-apply-the-identity-across-the-workspace/evidence/normal-chromium"
  await mkdir(directory, { recursive: true })
  const reference = await Promise.all(
    ["DESIGN.md", "css/tokens.css", "css/hall.css", "js/hall.js"].map(async (path) => ({
      path: `docs/mockups/library/${path}`,
      sha256: createHash("sha256")
        .update(await readFile(`docs/mockups/library/${path}`))
        .digest("hex"),
    })),
  )
  const study = fixture.lesson.studyId
  const setup = fixture.lesson.setupRevisionId
  const revision = fixture.definition.analysisRevisionId
  const analysis = fixture.storage.workflow.getAnalysis(revision)
  if (!analysis) throw new TypeError("Missing fixture analysis")
  const source = analysis.cacheInput.normalizationRevisionId
  const routes = [
    "/",
    "/imports",
    "/sources",
    `/sources/${source}`,
    `/sources/${source}/setup`,
    `/sources/${source}/setup/${setup}`,
    "/interviews",
    `/interviews/${study}`,
    `/interviews/${study}?lang=ja`,
    `/interviews/${study}?view=review`,
    `/interviews/${study}?view=review&lang=ja`,
    `/briefs/${study}`,
    `/outlines/${study}`,
    "/jobs",
    `/evidence/${study}`,
    `/evidence/${study}/${fixture.lesson.id}`,
    `/publications/${study}`,
    `/revisions/${study}`,
  ]
  const rows: { path: string; width: number; material: string; bounded: boolean; mains: number }[] =
    []
  try {
    const page = await browser.newPage()
    await page.goto(`${origin}/login`)
    await browserExpect(page.getByRole("button", { name: "Log in" })).toBeVisible()
    await page.getByLabel("Email").fill(fixture.credentials.email)
    await page.getByLabel("Password").fill(fixture.credentials.password)
    await page.getByRole("button", { name: "Log in" }).click()
    await page.waitForURL(`${origin}/`)
    for (const width of [375, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 })
      for (const path of routes) {
        await page.goto(`${origin}${path}`)
        await browserExpect(page.locator("main")).toBeVisible()
        await browserExpect(
          page.getByText(
            /^Loading (studio|sources|source|study|interview|brief|outline|jobs|evidence|publication|revision)/,
          ),
        ).toHaveCount(0)
        const navigation = page.getByRole("navigation", { name: "Workspace rooms" })
        await browserExpect(navigation).toBeVisible()
        const material = await navigation.evaluate(
          (element) => getComputedStyle(element).backgroundColor,
        )
        rows.push({
          path,
          width,
          material,
          bounded: await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          mains: await page.locator("main").count(),
        })
        await navigation
          .getByRole("link", { name: /Your sources/ })
          .first()
          .focus()
        await browserExpect(
          navigation.getByRole("link", { name: /Your sources/ }).first(),
        ).toBeFocused()
        await page.screenshot({
          path: `${directory}/${width}-${routes.indexOf(path)}.png`,
          fullPage: true,
        })
      }
      await page.goto(`${origin}/?fallback=1`)
      await browserExpect(page.getByRole("button", { name: "Log out" })).toBeVisible()
      await page.screenshot({ path: `${directory}/${width}-fallback.png`, fullPage: true })
      await page.goto(`${origin}/login`)
      await page.screenshot({ path: `${directory}/${width}-login.png`, fullPage: true })
    }
    for (const suffix of ["preview", "read"]) {
      const response = await page.goto(`${origin}/evidence/${study}/${fixture.lesson.id}/${suffix}`)
      expect(response?.status()).toBe(200)
      await browserExpect(page.locator("body")).toContainText("Ask a colleague")
      await page.screenshot({ path: `${directory}/${suffix}.png`, fullPage: true })
    }
    await writeFile(
      `${directory}/receipt.json`,
      JSON.stringify(
        {
          head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
          reference,
          rows,
          waiver: "Safari waived by user; Chromium only.",
          deployment:
            "Built studio with production asset router and real authenticated fixture APIs; separate asset-free owner fallback and server preview/read",
        },
        null,
        2,
      ),
    )
    expect(
      rows.filter((row) => row.material !== "rgb(37, 74, 64)" || !row.bounded || row.mains !== 1),
    ).toEqual([])
  } finally {
    await browser.close()
    await new Promise<void>((done, reject) =>
      server.close((error) => (error ? reject(error) : done())),
    )
    await fixture.close()
  }
}, 180_000)
