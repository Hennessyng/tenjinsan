import { execFileSync } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import { chromium, expect as visible } from "@playwright/test"
import { expect, it } from "vitest"
import { sourceViewerFixture } from "../../apps/server/src/testing/source-viewer-fixture.ts"

it("TEN-12 AC3 presents real absence without hiding existing sources", async () => {
  execFileSync("bun", ["run", "--cwd", "apps/studio", "build"], { stdio: "pipe" })
  const fixture = await sourceViewerFixture({ studioAssets: true })
  const browser = await chromium.launch()
  const directory = ".sisyphus/runs/ten-12-apply-the-identity-across-the-workspace/evidence/empty-chromium"
  await mkdir(directory, { recursive: true })
  const rows: { path: string; width: number; paper: string; bounded: boolean }[] = []
  try {
    const page = await browser.newPage()
    await page.goto(`${fixture.origin}/login`)
    await page.getByLabel("Email").fill(fixture.credentials.email)
    await page.getByLabel("Password").fill(fixture.credentials.password)
    await page.getByRole("button", { name: "Log in" }).click()
    await page.waitForURL(`${fixture.origin}/`)
    for (const width of [375, 768, 1280]) {
      await page.setViewportSize({ width, height: 700 })
      for (const [path, text] of [
        ["/interviews", "No question bank is ready yet."],
        ["/jobs", "No jobs on a current approved setup."],
        ["/sources/revision-fixture?chapter=2", "This resource was excluded:"],
        ["/sources/revision-fixture/setup", "No Codex models are available"],
      ]) {
        await page.goto(`${fixture.origin}${path}`)
        const empty = page.getByText(text ?? "", { exact: false }).first()
        await visible(empty).toBeVisible()
        rows.push({ path: path ?? "", width, paper: await empty.evaluate((node) => getComputedStyle(node).backgroundColor), bounded: await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth) })
        await page.screenshot({ path: `${directory}/${width}-${rows.length}.png`, fullPage: true })
        await page.getByRole("navigation", { name: "Workspace rooms" }).getByRole("link", { name: /Your sources/ }).first().click()
        await visible(page.getByRole("link", { name: "The art of paying attention" }).first()).toBeVisible()
        await visible(page.getByText("import-pending", { exact: false })).toBeVisible()
      }
    }
    await writeFile(`${directory}/receipt.json`, JSON.stringify({ rows, inapplicable: ["/login, / and owner fallback: static", "missing resources: errors, not empty"], waiver: "Safari waived by user; Chromium only." }))
    expect(rows.filter((row) => row.paper !== "rgb(255, 253, 248)" || !row.bounded)).toEqual([])
  } finally {
    await browser.close()
    await fixture.close()
  }
}, 180_000)
