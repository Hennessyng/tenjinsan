import { expect, test } from "@playwright/test"
import { publicationFixture } from "@reading-studio/server/publication-fixture"

test.describe("React publication approval", () => {
  let fixture: Awaited<ReturnType<typeof publicationFixture>>
  test.beforeEach(async ({ page }) => {
    fixture = await publicationFixture()
    await page.goto(`${fixture.origin}/login`)
    await page.getByLabel("Email").fill(fixture.credentials.email)
    await page.getByLabel("Password").fill(fixture.credentials.password)
    await page.getByRole("button", { name: "Log in" }).click()
    await page.route(/\/api\/publications\/.*$/, async (route) => {
      const url = new URL(route.request().url())
      await route.fulfill({
        response: await route.fetch({
          url: `${fixture.origin}${url.pathname}`,
          headers: { ...route.request().headers(), origin: fixture.origin },
        }),
      })
    })
    await page.route(/\/publication-artifacts\/.*$/, async (route) => {
      const url = new URL(route.request().url())
      await route.fulfill({
        response: await route.fetch({ url: `${fixture.origin}${url.pathname}` }),
      })
    })
  })
  test.afterEach(async () => {
    await fixture.close()
  })

  for (const width of [375, 768, 1280]) {
    test(`approves reviewed content and retains versioned files at ${width}px`, async ({
      page,
    }, testInfo) => {
      // Given: the cleaned projection has passed evidence and privacy review.
      await page.setViewportSize({ width, height: 900 })
      await page.goto("http://127.0.0.1:4173/publications/study-fixture")
      await expect(page.getByRole("button", { name: "Publish /" })).toBeEnabled()
      // When: publication is explicitly approved and files are generated.
      await page.getByRole("button", { name: "Publish /" }).click()
      await page.getByRole("button", { name: "Generate approved files" }).click()
      // Then: only owner-authenticated versions are offered.
      await expect(page.getByRole("link", { name: "Download HTML" })).toBeVisible()
      await expect(page.getByRole("link", { name: "Download PDF" })).toBeVisible()
      await page.screenshot({
        path: testInfo.outputPath(`react-publication-${width}.png`),
        fullPage: true,
      })
      const downloadEvent = page.waitForEvent("download")
      await page.getByRole("link", { name: "Download HTML" }).click()
      const download = await downloadEvent
      expect(download.suggestedFilename()).toMatch(/^publication-.+\.html$/)
      await page.getByRole("button", { name: "Keep private /" }).click()
      await expect(page.getByRole("status")).toContainText("Kept private")
      await expect(page.getByRole("heading", { name: /Old version/ })).toBeVisible()
      await expect(page.getByRole("link", { name: "Download HTML" })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
    })
  }
})
