import { execFileSync } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import { chromium, expect as visible } from "@playwright/test"
import { expect, it } from "vitest"
import { sourceViewerFixture } from "../../apps/server/src/testing/source-viewer-fixture.ts"

it("TEN-12 AC4 preserves failures and recovery inside the library", async () => {
  execFileSync("bun", ["run", "--cwd", "apps/studio", "build"], { stdio: "pipe" })
  const fixture = await sourceViewerFixture({ studioAssets: true })
  const browser = await chromium.launch()
  const directory =
    ".sisyphus/runs/ten-12-apply-the-identity-across-the-workspace/evidence/error-chromium"
  await mkdir(directory, { recursive: true })
  const rows: { path: string; width: number; paper: string; bounded: boolean }[] = []
  try {
    const page = await browser.newPage()
    await page.goto(`${fixture.origin}/login`)
    await page.getByLabel("Email").fill(fixture.credentials.email)
    await page.getByLabel("Password").fill("incorrect-synthetic-password")
    const response = page.waitForResponse(
      (reply) => reply.url().endsWith("/login") && reply.request().method() === "POST",
    )
    await page.getByRole("button", { name: "Log in" }).click()
    expect((await response).status()).toBe(401)
    await visible(page.getByRole("alert")).toContainText("Login failed")
    rows.push({
      path: "/login",
      width: 1280,
      paper: await page
        .getByRole("alert")
        .evaluate((node) => getComputedStyle(node).backgroundColor),
      bounded: true,
    })
    await page.getByLabel("Email").fill(fixture.credentials.email)
    await page.getByLabel("Password").fill(fixture.credentials.password)
    await page.getByRole("button", { name: "Log in" }).click()
    await page.waitForURL(`${fixture.origin}/`)
    for (const width of [375, 768, 1280]) {
      await page.setViewportSize({ width, height: 700 })
      for (const [path, selector] of [
        ["/sources/missing", "hgroup"],
        ["/interviews/missing", "main section.setup"],
        ["/sources/missing/setup", "main section.setup"],
        ["/briefs/missing", "main section.setup"],
        ["/outlines/missing", "main [role=alert]"],
        ["/evidence/missing", "main [role=alert]"],
        ["/publications/missing", "main [role=alert]"],
        ["/revisions/missing", "main section.setup"],
      ]) {
        await page.goto(`${fixture.origin}${path}`)
        const error = page.locator(selector ?? "").first()
        await visible(error).toBeVisible()
        await visible(error).toContainText(/unavailable|not found/i)
        rows.push({
          path: path ?? "",
          width,
          paper: await error.evaluate((node) => getComputedStyle(node).backgroundColor),
          bounded: await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        })
        await page.screenshot({ path: `${directory}/${width}-${rows.length}.png`, fullPage: true })
        await page
          .getByRole("navigation", { name: "Workspace rooms" })
          .getByRole("link", { name: /Your sources/ })
          .first()
          .click()
        await visible(
          page.getByRole("link", { name: "The art of paying attention" }).first(),
        ).toBeVisible()
      }
    }
    await writeFile(
      `${directory}/receipt.json`,
      JSON.stringify({ rows, waiver: "Safari waived by user; Chromium only." }),
    )
    expect(rows.filter((row) => row.paper !== "rgb(255, 253, 248)" || !row.bounded)).toEqual([])
  } finally {
    await browser.close()
    await fixture.close()
  }
}, 180_000)
