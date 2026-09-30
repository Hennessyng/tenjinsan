import { expect, test } from "@playwright/test"
import { briefFixture } from "./brief-fixture.ts"

test.describe("React revisions and provider choice", () => {
  let fixture: Awaited<ReturnType<typeof briefFixture>>
  test.beforeEach(async ({ page }) => {
    fixture = await briefFixture()
    await page.goto(`${fixture.origin}/login`)
    await page.getByLabel("Email").fill(fixture.credentials.email)
    await page.getByLabel("Password").fill(fixture.credentials.password)
    await page.getByRole("button", { name: "Log in" }).click()
    await page.route(/\/api\/revision-page\/.*$/, async (route) => {
      const url = new URL(route.request().url())
      await route.fulfill({
        response: await route.fetch({
          url: `${fixture.origin}${url.pathname}`,
          headers: { ...route.request().headers(), origin: fixture.origin },
        }),
      })
    })
  })
  test.afterEach(async () => {
    await fixture.close()
  })

  for (const width of [375, 768, 1280]) {
    test(`changes provider and requires fresh consent at ${width}px`, async ({
      page,
    }, testInfo) => {
      // Given: a current study and its provider settings.
      await page.setViewportSize({ width, height: 900 })
      await page.goto("http://127.0.0.1:4173/revisions/study-fixture")
      await expect(page.getByRole("heading", { name: "Study revisions /" })).toBeVisible()
      // When: a different provider is selected.
      await page
        .getByLabel("Provider and model /")
        .selectOption({ label: "Anthropic / Claude Sonnet 4.6" })
      await page.getByRole("button", { name: "Review provider change /" }).click()
      // Then: no grant or job is created until consent is explicit.
      await expect(page.getByRole("status")).toContainText("Fresh consent required")
      await page.screenshot({
        path: testInfo.outputPath(`react-revisions-${width}.png`),
        fullPage: true,
      })
      await expect(page.getByRole("heading", { name: /Old setup version/ })).toBeVisible()
      expect(fixture.storage.counts()).toMatchObject({ grants: 0, jobs: 0 })
      await page.getByRole("button", { name: "Approve transmission /" }).click()
      await expect(page.getByRole("status")).toContainText("Transmission approved")
      expect(fixture.storage.counts()).toMatchObject({ grants: 1, jobs: 0 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
    })
  }

  test("forks an independent lens without transferring consent", async ({ page }) => {
    await page.goto("http://127.0.0.1:4173/revisions/study-fixture")
    await page.getByRole("button", { name: "Fork a second lens /" }).click()
    await expect(page.getByRole("heading", { name: "Forked study /" })).toBeVisible()
    const forkId = new URL(page.url()).pathname.split("/").at(-1)
    expect(forkId).not.toBe("study-fixture")
    await expect(page.getByRole("status")).toContainText("Fresh consent required")
    expect(fixture.storage.counts().grants).toBe(0)
  })
})
