import { expect, test } from "@playwright/test"
import { evidenceFixture } from "@reading-studio/server/evidence-fixture"

test.describe("React evidence and privacy review", () => {
  let fixture: Awaited<ReturnType<typeof evidenceFixture>>
  test.beforeEach(async ({ page }) => {
    fixture = await evidenceFixture()
    await page.goto(`${fixture.origin}/login`)
    await page.getByLabel("Email").fill(fixture.credentials.email)
    await page.getByLabel("Password").fill(fixture.credentials.password)
    await page.getByRole("button", { name: "Log in" }).click()
    await page.route(/\/api\/evidence\/.*$/, async (route) => {
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
    test(`corrects privacy findings before review at ${width}px`, async ({ page }, testInfo) => {
      // Given: a lesson projection with a private detail.
      await page.setViewportSize({ width, height: 900 })
      await page.goto(`http://127.0.0.1:4173${fixture.path}`)
      await expect(page.getByRole("heading", { name: "Evidence and privacy /" })).toBeVisible()
      await expect(page.getByRole("button", { name: "Confirm privacy review" })).toBeDisabled()
      // When: the owner corrects the identified projected value.
      await page.getByText("Inspect every projected value", { exact: false }).click()
      await page
        .locator("summary")
        .filter({ hasText: /^\/sections\/0\/content\/en$/u })
        .click()
      await page
        .getByLabel("Correct /sections/0/content/en", { exact: true })
        .fill("Ask a colleague what they heard.")
      await page.getByRole("button", { name: "Save correction" }).click()
      // Then: new review decisions are needed for the corrected revision.
      await expect(page.getByRole("button", { name: "Confirm privacy review" })).toBeEnabled()
      for (const category of ["support", "qualification", "translation", "visual"])
        await page
          .getByRole("button", { name: `Acknowledge ${category} uncertainty`, exact: true })
          .click()
      await page.getByRole("button", { name: "Confirm privacy review" }).click()
      await expect(page.getByRole("status")).toContainText("Ready for later publication approval")
      await page.screenshot({
        path: testInfo.outputPath(`react-evidence-${width}.png`),
        fullPage: true,
      })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
    })
  }

  test("rejects a forged privacy acknowledgement and a stale review", async ({ page }) => {
    await page.goto(`http://127.0.0.1:4173${fixture.path}`)
    await expect(page.getByRole("heading", { name: "Evidence and privacy /" })).toBeVisible()
    const id = fixture.storage.reviews.current(fixture.lesson.id)?.id
    if (!id) throw new TypeError("Missing current review")
    const endpoint = `${fixture.origin}/api${fixture.path}`
    const headers = { origin: fixture.origin, "content-type": "application/json" }
    const forged = await page.request.post(endpoint, {
      headers,
      data: { expectedId: id, action: "semantic", category: "privacy", status: "acknowledged" },
    })
    expect(forged.status()).toBe(422)
    const stale = await page.request.post(endpoint, {
      headers,
      data: { expectedId: "obsolete-review", action: "privacy-reviewed" },
    })
    expect(stale.status()).toBe(409)
    await expect(page.getByRole("button", { name: "Confirm privacy review" })).toBeDisabled()
  })
})
