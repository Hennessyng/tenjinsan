import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { expect, test } from "@playwright/test"
import { publicationFixture } from "@reading-studio/server/publication-fixture"

test("captures all ordinary application surfaces in both interface languages at three widths", async ({
  browser,
}) => {
  test.setTimeout(180_000)
  const fixture = await publicationFixture({ studioAssets: true })
  const evidence = join(
    process.cwd(),
    ".sisyphus/runs/TEN-19/evidence/app-surfaces",
    crypto.randomUUID(),
  )
  await mkdir(evidence, { recursive: true })
  const study = fixture.lesson.studyId
  const setupId = fixture.storage.sources.getLatestSetup(study)?.id
  const routes = [
    ["hall", "/"],
    ["import", "/imports"],
    ["source", "/sources/revision-fixture"],
    ["setup", "/sources/revision-fixture/setup"],
    ["send-review", `/sources/revision-fixture/setup/${setupId}`],
    ["interview", `/interviews/${study}`],
    ["brief", `/briefs/${study}`],
    ["outline", `/outlines/${study}`],
    ["jobs", "/jobs"],
    ["evidence", `/evidence/${study}/${fixture.lesson.id}`],
    ["revisions", `/revisions/${study}`],
    ["publication", `/publications/${study}`],
  ] as const
  try {
    if (setupId === undefined) throw new TypeError("Missing setup-review fixture")
    for (const locale of ["en", "ja"] as const) {
      const context = await browser.newContext()
      try {
        await context.addInitScript(
          (value) => localStorage.setItem("tenjinsan.ui-language", value),
          locale,
        )
        const page = await context.newPage()
        const errors: string[] = []
        const writes: string[] = []
        page.on("pageerror", (error) => errors.push(error.message))
        page.on("request", (request) => {
          if (request.method() !== "GET") writes.push(request.url())
        })
        for (const [name, path] of routes) {
          await page.goto(`${fixture.origin}${path}`)
          await expect(page.locator("html")).toHaveAttribute("lang", locale)
          await expect(page.locator(".language-switch button[aria-pressed=true]")).toHaveAttribute(
            "lang",
            locale,
          )
          if (name !== "hall") {
            await expect(page.locator("#desk .sheet .source-app")).toBeVisible()
            await expect(page.locator("#desk .sheet .workspace-loading")).toHaveCount(0)
          }
          for (const width of [375, 768, 1280]) {
            await page.setViewportSize({ width, height: 900 })
            if (name !== "hall")
              await page.locator(".desk-main").evaluate((pane) => {
                pane.scrollTop = 0
              })
            expect(
              await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
            ).toBe(true)
            await page.screenshot({
              path: join(evidence, `${name}-${locale}-${width}.png`),
              fullPage: true,
            })
            if (name !== "hall") {
              await page.locator(".desk-main").evaluate((pane) => {
                pane.scrollTop = pane.scrollHeight
              })
              await page.screenshot({
                path: join(evidence, `${name}-${locale}-${width}-bottom.png`),
                fullPage: true,
              })
            }
            if (name === "publication") {
              await page.locator("#export-ui").scrollIntoViewIfNeeded()
              await expect(page.locator("#export-ui")).toHaveValue("en")
              await page.screenshot({
                path: join(evidence, `${name}-${locale}-${width}-choice.png`),
                fullPage: true,
              })
            }
            if (name === "send-review") {
              await page.locator("#desk .sheet .source-app .setup-actions").scrollIntoViewIfNeeded()
              await page.screenshot({
                path: join(evidence, `${name}-${locale}-${width}-actions.png`),
                fullPage: true,
              })
            }
          }
        }
        expect(errors).toEqual([])
        expect(writes).toEqual([])
      } finally {
        await context.close()
      }
    }
    console.log(
      `TEN-19 surface evidence: ${evidence}; 72 top + 66 desk-bottom + 6 export-choice + 6 send-action captures`,
    )
  } finally {
    await fixture.close()
  }
})
