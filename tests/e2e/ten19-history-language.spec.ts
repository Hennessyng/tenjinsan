import { expect, type Page, test } from "@playwright/test"
import { sourceViewerFixture } from "@reading-studio/server/source-viewer-fixture"

async function englishImportsWithJapaneseHistory(page: Page, origin: string): Promise<void> {
  await page.goto(`${origin}/?lang=ja`)
  await page.locator("#route li button").first().click()
  await expect(page.locator('input[type="file"]')).toBeVisible()
  await page.getByRole("button", { name: "English", exact: true }).click()
  await expect(page.locator("html")).toHaveAttribute("lang", "en")
  await expect(page).toHaveURL(/\/imports\?lang=en$/)
}

test("accepted back/forward URL language wins and updates the remembered choice", async ({
  browser,
}) => {
  const fixture = await sourceViewerFixture({ studioAssets: true })
  const context = await browser.newContext()
  try {
    const page = await context.newPage()
    await englishImportsWithJapaneseHistory(page, fixture.origin)
    await page.goBack()
    await expect(page).toHaveURL(/\/\?lang=ja$/)
    await expect(page.locator("html")).toHaveAttribute("lang", "ja")
    expect(await page.evaluate(() => localStorage.getItem("tenjinsan.ui-language"))).toBe("ja")
    await page.goForward()
    await expect(page).toHaveURL(/\/imports\?lang=en$/)
    await expect(page.locator("html")).toHaveAttribute("lang", "en")
    expect(await page.evaluate(() => localStorage.getItem("tenjinsan.ui-language"))).toBe("en")
  } finally {
    await context.close()
    await fixture.close()
  }
})

test("cancelled back navigation keeps draft, URL and language; confirmed back applies explicit language", async ({
  browser,
}) => {
  const fixture = await sourceViewerFixture({ studioAssets: true })
  const context = await browser.newContext()
  try {
    const page = await context.newPage()
    await englishImportsWithJapaneseHistory(page, fixture.origin)
    await page.locator('input[type="file"]').setInputFiles({
      name: "history-draft.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Synthetic draft"),
    })
    await page.evaluate(() => history.back())
    await expect(page.getByRole("dialog")).toBeVisible()
    await expect(page).toHaveURL(/\/imports\?lang=en$/)
    await expect(page.locator("html")).toHaveAttribute("lang", "en")
    expect(await page.evaluate(() => localStorage.getItem("tenjinsan.ui-language"))).toBe("en")
    await page.getByRole("button", { name: "Stay", exact: true }).click()
    expect(
      await page
        .locator('input[type="file"]')
        .evaluate((input: HTMLInputElement) => input.files?.length),
    ).toBe(1)
    await page.evaluate(() => history.back())
    await expect(page.getByRole("dialog")).toBeVisible()
    await expect(page).toHaveURL(/\/imports\?lang=en$/)
    await page.getByRole("button", { name: "Leave and discard", exact: true }).click()
    await expect(page).toHaveURL(/\/\?lang=ja$/)
    await expect(page.locator("html")).toHaveAttribute("lang", "ja")
    expect(await page.evaluate(() => localStorage.getItem("tenjinsan.ui-language"))).toBe("ja")
  } finally {
    await context.close()
    await fixture.close()
  }
})
