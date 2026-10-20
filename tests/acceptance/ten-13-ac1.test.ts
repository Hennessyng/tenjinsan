import { execFileSync } from "node:child_process"
import { chromium, type Locator, type Page, expect as visible } from "@playwright/test"
import { it } from "vitest"
import { sourceViewerFixture } from "../../apps/server/src/testing/source-viewer-fixture.ts"

async function tabTo(page: Page, target: Locator): Promise<void> {
  for (let count = 0; count < 80; count++) {
    await page.keyboard.press("Tab")
    if (await target.evaluate((node) => node === document.activeElement)) return
  }
  await visible(target).toBeFocused()
}

it("TEN-13 AC1 operates native workspace entrypoints by keyboard", async () => {
  execFileSync("bun", ["run", "--cwd", "apps/studio", "build"], { stdio: "pipe" })
  const fixture = await sourceViewerFixture({ studioAssets: true })
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.goto(`${fixture.origin}/login`)
    await tabTo(page, page.getByLabel("Email"))
    await page.keyboard.type(fixture.credentials.email)
    await page.keyboard.press("Tab")
    await page.keyboard.type(fixture.credentials.password)
    await page.keyboard.press("Tab")
    await page.keyboard.press("Enter")
    await page.waitForURL(`${fixture.origin}/`)
    await page.getByRole("status", { name: "Entering the library" }).waitFor({ state: "detached" })
    await tabTo(page, page.locator(".skip-link"))
    await page.keyboard.press("Enter")
    await visible(page.locator("main")).toBeFocused()
    await page.keyboard.press("Tab")
    await visible(page.locator("main :focus")).toHaveCount(1)
    await page.keyboard.press("Shift+Tab")
    await tabTo(
      page,
      page
        .getByRole("navigation")
        .getByRole("button", { name: /1\. Import & read/ })
        .first(),
    )
    await page.keyboard.press("Enter")
    await page.waitForURL(`${fixture.origin}/imports`)
    await visible(page.getByRole("heading", { name: "Your sources" })).toBeVisible()
    await tabTo(page, page.locator(".skip-link"))
    await page.keyboard.press("Enter")
    await visible(page.locator("#desk-title")).toBeFocused()
    await tabTo(page, page.locator('a[href="/sources/revision-fixture"]'))
    await page.keyboard.press("Enter")
    await page.waitForURL(`${fixture.origin}/sources/revision-fixture`)
    await visible(page.locator("#chapter-title")).toBeFocused()
    await tabTo(page, page.getByRole("link", { name: "Chapter 2" }))
    await page.keyboard.press("Enter")
    await visible(page.getByText("Reading is a conversation across time.")).toBeVisible()
    await page.setViewportSize({ width: 375, height: 800 })
    const mobileRoute = page.getByRole("navigation", { name: "Reading route / 読書ルート" })
    await visible(mobileRoute).toBeVisible()
    await visible(mobileRoute.getByRole("button")).toHaveCount(9)
    await tabTo(page, mobileRoute.getByRole("button", { name: /1\. Import & read/ }))
    await page.keyboard.press("Space")
    await page.waitForURL(`${fixture.origin}/imports`)
    await visible(page.getByLabel("Choose EPUB")).toBeVisible()
    await tabTo(page, mobileRoute.getByRole("button", { name: /1\. Import & read/ }))
    await page.keyboard.press("Enter")
    await page.waitForURL(`${fixture.origin}/imports`)
    await page.goto(`${fixture.origin}/sources/missing`)
    await visible(page.getByRole("heading", { name: "Missing reference" })).toBeVisible()
    await tabTo(page, page.getByRole("link", { name: "Return to your sources" }))
    await page.keyboard.press("Enter")
    await page.waitForURL(`${fixture.origin}/sources`)
    await page.goto(`${fixture.origin}/imports`)
    await tabTo(page, page.locator(".skip-link"))
    await page.keyboard.press("Enter")
    await visible(page.locator("#desk-title")).toBeFocused()
    await tabTo(page, page.getByLabel("Choose EPUB"))
    await visible(page.getByLabel("Choose EPUB")).toBeFocused()
  } finally {
    await browser.close()
    await fixture.close()
  }
}, 120_000)
