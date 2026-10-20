import { execFileSync } from "node:child_process"
import { mkdir } from "node:fs/promises"
import { chromium, type Page, expect as visible } from "@playwright/test"
import { expect, it } from "vitest"
import { sourceViewerFixture } from "../../apps/server/src/testing/source-viewer-fixture.ts"

async function meaningfulMain(page: Page): Promise<void> {
  expect(await page.getByRole("main").count()).toBe(1)
  await visible(page.getByRole("main")).toBeVisible()
  await visible(page.getByRole("main").getByRole("heading").first()).toBeVisible()
  expect(await page.locator("main main").count()).toBe(0)
}

it("TEN-16 S3 F2 keeps a meaningful single main through hall, loading, prerequisite and unavailable rooms", async () => {
  execFileSync("bun", ["run", "--cwd", "apps/studio", "build"], { stdio: "pipe" })
  const fixture = await sourceViewerFixture({ studioAssets: true })
  const browser = await chromium.launch()
  let fixtureOpen = true
  const directory =
    ".sisyphus/runs/ten-16-bring-the-mockup-library-journey-into-tenjinsan/evidence/reconciliation-20261005/F2-captures"
  await mkdir(directory, { recursive: true })
  let release = () => {}
  try {
    const page = await browser.newPage({ reducedMotion: "reduce" })
    await page.goto(`${fixture.origin}/login`)
    await page.getByLabel("Email").fill(fixture.credentials.email)
    await page.getByLabel("Password").fill(fixture.credentials.password)
    await page.getByRole("button", { name: "Log in" }).click()
    await page.waitForURL(`${fixture.origin}/`)
    const navigation = page.getByRole("navigation", { name: "Reading route / 読書ルート" })
    await visible(navigation).toBeVisible()

    await meaningfulMain(page)
    for (const width of [375, 1280]) {
      await page.setViewportSize({ width, height: 900 })
      await meaningfulMain(page)
      await page.screenshot({ path: `${directory}/hall-${width}.png` })
    }
    await page.getByLabel("Selected study / 選択した読書").selectOption("study-fixture")
    await page.getByRole("button", { name: "Select study / 読書を選ぶ", exact: true }).click()
    await visible(page.locator(".identity")).toContainText("study-fixture")
    const mutations: string[] = []
    page.on("request", (request) => {
      if (request.method() === "POST") mutations.push(new URL(request.url()).pathname)
    })
    let observed = () => {}
    const observation = new Promise<void>((resolve) => {
      observed = resolve
    })
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route("**/api/library-context", async (route) => {
      const response = await route.fetch()
      observed()
      await held
      await route.fulfill({ response })
    })
    await navigation.getByRole("button", { name: /1\. Import & read/ }).click()
    await observation
    await visible(
      page
        .getByRole("status")
        .filter({ hasText: /Checking/ })
        .first(),
    ).toBeVisible()
    await meaningfulMain(page)
    release()
    await page.unrouteAll({ behavior: "wait" })
    await visible(page.getByLabel("Choose EPUB")).toBeVisible()
    await meaningfulMain(page)
    await navigation.getByRole("button", { name: /4\. Reference desk/ }).click()
    await visible(page.locator(".sheet")).toContainText("No saved question bank is available.")
    await meaningfulMain(page)
    await visible(page.getByRole("main").getByRole("link").first()).toBeVisible()
    await page.screenshot({ path: `${directory}/missing.png` })
    expect(mutations).toEqual([])
    await fixture.close()
    fixtureOpen = false
    await navigation.getByRole("button", { name: /7\. Bindery/ }).click()
    await visible(page.getByRole("main")).toContainText("Library unavailable")
    await meaningfulMain(page)
    await page.screenshot({ path: `${directory}/unavailable.png` })
  } finally {
    release()
    await browser.close()
    if (fixtureOpen) await fixture.close()
  }
}, 120_000)
