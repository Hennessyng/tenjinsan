import { once } from "node:events"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { chromium, expect, test } from "@playwright/test"
import { exportHtml } from "@reading-studio/export/html"
import { approved, breakout } from "@reading-studio/export/testing"
import { assetProjection, resolveFixtureAsset } from "@reading-studio/export/testing/assets"
import { Window } from "happy-dom"
import { assertStaticInventory, staticInventory } from "./html-inventory.ts"

const evidence = ".omo/evidence/reading-studio/task-25"
const requests: {
  readonly mode: string
  readonly external: readonly string[]
  readonly errors: readonly string[]
}[] = []
let directory: string
let url: string
let exportedDocument: string
test.beforeAll(async ({ browser }) => {
  directory = await mkdtemp(join(tmpdir(), "reading-export-"))
  await mkdir(evidence, { recursive: true })
  exportedDocument = await exportHtml(approved(assetProjection), resolveFixtureAsset)
  const server = createServer((_request, response) => {
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": 'attachment; filename="lesson.html"',
    })
    response.end(exportedDocument)
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Fixture failed to listen")
  const context = await browser.newContext()
  const page = await context.newPage()
  try {
    await page.setContent(`<a href="http://127.0.0.1:${address.port}/lesson.html">Download</a>`)
    const received = page.waitForEvent("download")
    await page.getByRole("link").click()
    await (await received).saveAs(join(directory, "lesson.html"))
  } finally {
    await context.close()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
  expect(server.listening).toBe(false)
  await writeFile(`${evidence}/offline.html`, exportedDocument)
  url = pathToFileURL(join(directory, "lesson.html")).href
})
test.afterAll(async () => {
  await writeFile(`${evidence}/requests.json`, JSON.stringify(requests, null, 2))
  await rm(directory, { recursive: true, force: true })
})

for (const mode of ["interactive", "javascript-disabled", "webgl-disabled"] as const) {
  test(`html: offline file retains teaching content in ${mode}`, async ({ browser }) => {
    // Given
    const isolated =
      mode === "webgl-disabled" ? await chromium.launch({ args: ["--disable-webgl"] }) : null
    const context = await (isolated ?? browser).newContext({
      offline: true,
      javaScriptEnabled: mode !== "javascript-disabled",
      viewport: { width: 1280, height: 900 },
    })
    try {
      const external: string[] = []
      const errors: string[] = []
      await context.route(/https?:\/\//, (route) => {
        external.push(route.request().url())
        return route.abort()
      })
      const page = await context.newPage()
      page.on("request", (request) => {
        if (!request.url().startsWith("file:") && !request.url().startsWith("data:"))
          external.push(request.url())
      })
      page.on("pageerror", (error) => errors.push(error.message))
      // When
      await page.goto(url)
      // Then: independent fixture inventory, not the renderer's manifest.
      await assertStaticInventory(page)
      await expect(page.locator("#breakout")).toHaveCount(0)
      expect(await page.evaluate(() => Reflect.get(globalThis, "pwned"))).toBeUndefined()
      await expect(page.locator(".chapter > .pair").first()).toContainText(breakout)
      const decoded = await page.locator("#publication-data").textContent()
      expect(decoded).not.toContain("PRIVATE_")
      expect(JSON.parse(decoded ?? "null")).toEqual(assetProjection)
      await expect(page.locator('img[src^="data:"]')).toBeVisible()
      expect(
        await page
          .locator('img[src^="data:"]')
          .evaluate(
            (image) =>
              image instanceof HTMLImageElement && image.complete && image.naturalWidth === 1,
          ),
      ).toBe(true)
      expect(
        await page.evaluate(async () => {
          await document.fonts.ready
          return (
            document.fonts.check('16px "ExportFont0"') &&
            [...document.fonts].some(
              (font) => font.family === "ExportFont0" && font.status === "loaded",
            )
          )
        }),
      ).toBe(true)
      for (const choice of await page.locator(".practice-option input").all()) await choice.check()
      await assertStaticInventory(page)
      if (mode === "interactive") {
        const scene = page.locator("[data-svg-scene]").first()
        await scene.locator("[data-select-state]").nth(1).click()
        await expect(scene.locator("[data-seek]")).toHaveValue("1200")
        await scene.locator("[data-play]").click()
        await expect(scene).toHaveAttribute("data-playback", "playing")
        await scene.locator("[data-pause]").click()
        await expect(scene).toHaveAttribute("data-playback", "paused")
        const spatial = page.locator("[data-three-scene]").first()
        await spatial.locator("[data-view]").nth(1).click()
        await expect(spatial).toHaveAttribute("data-renderer", "ready")
        await expect(spatial.locator("[data-view]").nth(1)).toHaveAttribute("aria-pressed", "true")
      }
      if (mode === "webgl-disabled") {
        const spatial = page.locator("[data-three-scene]").first()
        await spatial.scrollIntoViewIfNeeded()
        await expect(spatial).toHaveAttribute("data-renderer", "fallback")
      }
      for (const width of [375, 768, 1280]) {
        await page.setViewportSize({ width, height: 900 })
        await page.evaluate(() => window.scrollTo(0, 0))
        await expect(page.locator("h1")).toBeInViewport()
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        )
        await page.screenshot({ path: `${evidence}/${mode}-${width}.png` })
        await page
          .locator("[data-svg-scene]")
          .first()
          .screenshot({ path: `${evidence}/scene-${mode}-${width}.png` })
        await page
          .locator("[data-three-scene]")
          .first()
          .screenshot({ path: `${evidence}/spatial-${mode}-${width}.png` })
        await page
          .locator("section.practice")
          .last()
          .screenshot({ path: `${evidence}/practice-${mode}-${width}.png` })
      }
      if (mode === "interactive") {
        await page.evaluate(() => window.scrollTo(0, 0))
        await expect(page.locator("h1")).toBeInViewport()
        await page.screenshot({ path: `${evidence}/offline.png` })
      }
      expect(external).toEqual([])
      expect(errors).toEqual([])
      requests.push({ mode, external, errors })
      await writeFile(
        `${evidence}/requests-${mode}.json`,
        JSON.stringify({ external, errors, url }, null, 2),
      )
    } finally {
      await context.close()
      await isolated?.close()
    }
  })
}

for (const mode of ["javascript-disabled", "webgl-disabled"] as const) {
  test(`html: verifier rejects every omitted state or explanation in ${mode}`, async ({
    browser,
  }) => {
    test.setTimeout(120_000)
    const isolated =
      mode === "webgl-disabled" ? await chromium.launch({ args: ["--disable-webgl"] }) : null
    const context = await (isolated ?? browser).newContext({
      offline: true,
      javaScriptEnabled: mode !== "javascript-disabled",
    })
    const page = await context.newPage()
    const rejected: string[] = []
    try {
      for (const [id] of staticInventory) {
        for (const omission of ["state", "en", "ja"] as const) {
          const window = new Window({ settings: { disableJavaScriptEvaluation: true } })
          try {
            window.document.write(exportedDocument)
            const state = window.document.querySelector(`main [data-state="${id}"]`)
            const target =
              omission === "state"
                ? state
                : state?.querySelector(`.pair:last-child p[lang="${omission}"]`)
            expect(target, `mutation target ${id}/${omission}`).not.toBeNull()
            target?.remove()
            const file = join(directory, "omitted.html")
            await writeFile(file, `<!doctype html>${window.document.documentElement.outerHTML}`)
            await page.goto(pathToFileURL(file).href)
            await expect(assertStaticInventory(page)).rejects.toThrow(
              omission === "state" ? id : `${id}/${omission}: missing explanation`,
            )
            rejected.push(`${id}/${omission}`)
          } finally {
            await window.happyDOM.close()
          }
        }
      }
      await writeFile(`${evidence}/omissions-${mode}.json`, JSON.stringify({ rejected }, null, 2))
    } finally {
      await context.close()
      await isolated?.close()
    }
  })
}
