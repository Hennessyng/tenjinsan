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
      for (const [path, endpoint] of [
        ["/sources/missing", "/api/source-reader/missing"],
        ["/interviews/missing", "/api/interviews/missing"],
        ["/sources/missing/setup", "/api/study-setup/missing"],
        ["/briefs/missing", "/api/briefs/missing"],
        ["/outlines/missing", "/api/outlines/missing"],
        ["/evidence/missing", "/api/evidence/missing"],
        ["/publications/missing", "/api/publications/missing"],
        ["/revisions/missing", "/api/revision-page/missing"],
      ]) {
        await page.goto(`${fixture.origin}${path}`)
        expect((await page.request.get(`${fixture.origin}${endpoint}`)).status()).toBe(404)
        const error = page.locator(".sheet").first()
        await visible(error).toBeVisible()
        await visible(error).toContainText(
          /unavailable|not found|Missing reference|Choose an owned study/i,
        )
        await visible(error.getByRole("link").first()).toBeVisible()
        rows.push({
          path: path ?? "",
          width,
          paper: await error.evaluate(
            (node) => getComputedStyle(node.closest("#desk-body") ?? node).backgroundColor,
          ),
          bounded: await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        })
        await page.screenshot({ path: `${directory}/${width}-${rows.length}.png`, fullPage: true })
        await page
          .getByRole("navigation", { name: "Reading route / 読書ルート" })
          .getByRole("button", { name: /2\. The stacks/ })
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
    expect(
      rows.filter(
        (row) =>
          row.paper !== (row.path === "/login" ? "rgb(255, 253, 248)" : "rgb(245, 241, 233)") ||
          !row.bounded,
      ),
    ).toEqual([])
  } finally {
    await browser.close()
    await fixture.close()
  }
}, 180_000)
