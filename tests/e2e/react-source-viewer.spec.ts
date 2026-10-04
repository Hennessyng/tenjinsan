import { expect, test } from "@playwright/test"
import { sourceViewerFixture } from "@reading-studio/server/source-viewer-fixture"

test.describe("React source reader", () => {
  let fixture: Awaited<ReturnType<typeof sourceViewerFixture>>

  test.beforeAll(async () => {
    fixture = await sourceViewerFixture()
  })
  test.afterAll(async () => {
    await fixture.close()
  })
  test.beforeEach(async ({ page }) => {
    await page.goto(`${fixture.origin}/login`)
    await page.getByLabel("Email").fill(fixture.credentials.email)
    await page.getByLabel("Password").fill(fixture.credentials.password)
    await page.getByRole("button", { name: "Log in" }).click()
    await expect(page.locator('[data-authenticated="true"]')).toBeVisible()
    await page.route(/\/api\/source-(?:library|reader\/.*)/, async (route) => {
      const url = new URL(route.request().url())
      await route.fulfill({
        response: await route.fetch({ url: `${fixture.origin}${url.pathname}${url.search}` }),
      })
    })
  })

  for (const width of [375, 768, 1280]) {
    test(`reads owned citations and queued imports at ${width}px`, async ({ page }, testInfo) => {
      // Given: an authenticated owner and a saved source with a citation.
      await page.setViewportSize({ width, height: 900 })
      // When: the React library and reader are opened.
      await page.goto("http://127.0.0.1:4173/sources")
      await expect(page.getByRole("heading", { name: "Your sources" })).toBeVisible()
      await expect(page.getByText("import-pending")).toBeVisible()
      await page.goto(`http://127.0.0.1:4173/sources/revision-fixture?citation=${fixture.citation}`)
      // Then: the exact citation is highlighted and the passage receives focus.
      await expect(page.locator("mark")).toHaveText("A good question opens a door.")
      await expect(page.locator("#passage")).toBeFocused()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
      await page.screenshot({
        path: testInfo.outputPath(`react-reader-${width}.png`),
        fullPage: true,
      })
      await page.getByRole("link", { name: "Chapter 2" }).click()
      await expect(page.getByText("Reading is a conversation across time.")).toBeVisible()
    })
  }

  test("rejects unowned and cross-revision citations without rendering source markup", async ({
    page,
  }) => {
    // Given: a signed-in owner without access to the requested edition.
    // When: a foreign revision is requested.
    await page.goto(`http://127.0.0.1:4173/sources/foreign-revision?citation=${fixture.citation}`)
    // Then: no source text is disclosed.
    await expect(page.getByRole("heading", { name: "Missing reference" })).toBeVisible()
    await expect(page.getByText("A good question opens a door.")).toHaveCount(0)
    await page.goto(`http://127.0.0.1:4173/sources/revision-other?citation=${fixture.citation}`)
    await expect(page.getByRole("heading", { name: "Missing reference" })).toBeVisible()
    await page.goto("http://127.0.0.1:4173/sources/revision-fixture")
    await expect(page.locator("#unsafe")).toContainText("<img src=")
    await expect(page.locator("img, iframe, object, embed, script:not([type=module])")).toHaveCount(
      0,
    )
  })

  test("does not disclose source text to an anonymous visitor", async ({ page }) => {
    // Given: no owner session.
    await page.context().clearCookies()
    // When: the source is opened directly.
    await page.goto("http://127.0.0.1:4173/sources/revision-fixture")
    // Then: no source passage is rendered.
    await expect(page.getByText("Attention begins with a question.")).toHaveCount(0)
    await expect(page.getByRole("alert")).toBeVisible()
  })
})
