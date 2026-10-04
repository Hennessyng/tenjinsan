import { execFileSync } from "node:child_process"
import { chromium, expect as visible, type Locator, type Page } from "@playwright/test"
import { beforeAll, it } from "vitest"
import { sourceViewerFixture } from "../../apps/server/src/testing/source-viewer-fixture.ts"

beforeAll(() => {
  execFileSync("bun", ["run", "--cwd", "apps/studio", "build"], { stdio: "pipe" })
})

async function tabTo(page: Page, target: Locator): Promise<void> {
  for (let count = 0; count < 80; count++) {
    await page.keyboard.press("Tab")
    if (await target.evaluate((node) => node === document.activeElement)) return
  }
  await visible(target).toBeFocused()
}

async function workspace(check: (page: Page, origin: string) => Promise<void>): Promise<void> {
  const fixture = await sourceViewerFixture({ studioAssets: true })
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.goto(`${fixture.origin}/login`)
    await page.getByLabel("Email").fill(fixture.credentials.email)
    await page.getByLabel("Password").fill(fixture.credentials.password)
    await page.getByRole("button", { name: "Log in" }).click()
    await page.waitForURL(`${fixture.origin}/`)
    await check(page, fixture.origin)
  } finally {
    await browser.close()
    await fixture.close()
  }
}

it("TEN-13 AC2 focuses the validation error when a keyboard submission omits chapters", async () => {
  await workspace(async (page, origin) => {
    await page.goto(`${origin}/sources/revision-fixture/setup`)
    await page.getByRole("radio", { name: "Choose specific chapters" }).check()
    const submit = page.getByRole("button", { name: "Review transmission", exact: true })
    await visible(submit).toBeEnabled()
    await tabTo(page, submit)

    await page.keyboard.press("Enter")

    await visible(page.getByRole("alert")).toBeFocused()
    await visible(page.getByRole("alert")).toHaveText("Select available chapters explicitly.")
    await page.keyboard.press("Tab")
    await visible(page.getByRole("link", { name: "Back to source preview" })).toBeFocused()
  })
}, 120_000)

it("TEN-13 AC2 focuses the result when cancellation removes the active control", async () => {
  await workspace(async (page, origin) => {
    await page.goto(`${origin}/sources/revision-fixture/setup`)
    await page.getByRole("checkbox", { name: "chapter-two.xhtml", exact: true }).check()
    await page.getByRole("button", { name: "Review transmission", exact: true }).click()
    await page.waitForURL(/\/setup\/[^/]+$/)
    await tabTo(page, page.getByRole("button", { name: "Cancel", exact: true }))

    await page.keyboard.press("Enter")

    const result = page.getByRole("heading", { name: "Transmission cancelled", exact: true })
    await visible(result).toBeFocused()
    await visible(result).toBeInViewport()
    await page.keyboard.press("Tab")
    await visible(page.getByRole("link", { name: "Return to setup", exact: true })).toBeFocused()
  })
}, 120_000)

it("TEN-13 AC2 retains the refresh control when the job list updates", async () => {
  await workspace(async (page, origin) => {
    await page.goto(`${origin}/jobs`)
    const refresh = page.getByRole("button", { name: /Refresh status/ })
    await visible(page.getByRole("status")).toContainText("No jobs")
    await tabTo(page, refresh)

    await page.keyboard.press("Enter")

    await visible(refresh).toBeEnabled()
    await visible(refresh).toBeFocused()
    await page.keyboard.press("Shift+Tab")
    await visible(page.locator("header :focus")).toHaveCount(1)
  })
}, 120_000)
