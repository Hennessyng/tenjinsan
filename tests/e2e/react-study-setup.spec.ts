import { expect, test } from "@playwright/test"
import { sourceViewerFixture } from "@reading-studio/server/source-viewer-fixture"

test.describe("React study setup", () => {
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
    await page.route(/\/api\/study-setup\/.*$/, async (route) => {
      const url = new URL(route.request().url())
      await route.fulfill({
        response: await route.fetch({
          url: `${fixture.origin}${url.pathname}${url.search}`,
          headers: { ...route.request().headers(), origin: fixture.origin },
        }),
      })
    })
  })

  for (const width of [375, 768, 1280]) {
    test(`reviews selected scope before saving consent at ${width}px`, async ({
      page,
    }, testInfo) => {
      // Given: a signed-in owner with an included and an excluded resource.
      await page.setViewportSize({ width, height: 900 })
      await page.goto("http://127.0.0.1:4173/sources/revision-fixture/setup")
      await expect(page.getByRole("heading", { name: "Set up a study" })).toBeVisible()
      await page.getByLabel("Provider and model").selectOption("anthropic")
      await page.getByLabel("Choose specific chapters").check()
      await page.getByLabel("chapter-one.xhtml", { exact: true }).check()
      const grantsBefore = fixture.storage.counts().grants
      // When: the owner requests the review.
      await page.getByRole("button", { name: "Review transmission" }).click()
      // Then: nothing is granted before an explicit Send decision.
      await expect(page.getByRole("heading", { name: "Review transmission" })).toBeVisible()
      await expect(page.locator("[data-selected]")).toContainText("chapter-one.xhtml")
      await expect(page.locator("[data-excluded]")).toContainText("chapter-two.xhtml")
      expect(fixture.storage.counts()).toMatchObject({ grants: grantsBefore, jobs: 0, attempts: 0 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
      await page.screenshot({
        path: testInfo.outputPath(`react-setup-${width}.png`),
        fullPage: true,
      })
      await page.getByRole("button", { name: "Cancel", exact: true }).click()
      await expect(page.getByRole("heading", { name: "Transmission cancelled" })).toBeVisible()
      expect(fixture.storage.counts().jobs).toBe(0)
    })
  }

  test("requires an available credential and rejects a stale review", async ({ page }) => {
    // Given: a draft for the current normalization.
    await page.goto("http://127.0.0.1:4173/sources/revision-fixture/setup")
    await page.getByRole("button", { name: "Review transmission" }).click()
    await expect(page.getByRole("heading", { name: "Review transmission" })).toBeVisible()
    const stale = page.url()
    // When: a newer draft replaces it.
    await page.getByRole("button", { name: "Revise", exact: true }).click()
    await page.getByLabel("Provider and model").selectOption("anthropic")
    await page.getByRole("button", { name: "Review transmission" }).click()
    await expect(page.getByRole("heading", { name: "Review transmission" })).toBeVisible()
    const current = page.url()
    await page.goto(stale)
    // Then: the old draft cannot authorize a transmission.
    await expect(page.getByRole("heading", { name: "Setup unavailable" })).toBeVisible()
    await page.goto(current)
    await page.getByRole("button", { name: "Send", exact: true }).click()
    await expect(page.getByRole("heading", { name: "Transmission approved" })).toBeVisible()
    expect(fixture.storage.counts()).toMatchObject({ jobs: 0, attempts: 0 })
    expect(fixture.storage.sources.getGrant(`grant-${current.split("/").at(-1)}`)?.kind).toBe(
      "active",
    )
  })

  test("does not offer Send without a configured API credential", async ({ page }) => {
    const missing = await sourceViewerFixture({ providerAvailable: false })
    try {
      await page.goto(`${missing.origin}/login`)
      await page.getByLabel("Email").fill(missing.credentials.email)
      await page.getByLabel("Password").fill(missing.credentials.password)
      await page.getByRole("button", { name: "Log in" }).click()
      await page.unrouteAll({ behavior: "wait" })
      await page.route(/\/api\/study-setup\/.*$/, async (route) => {
        const url = new URL(route.request().url())
        await route.fulfill({
          response: await route.fetch({
            url: `${missing.origin}${url.pathname}`,
            headers: { ...route.request().headers(), origin: missing.origin },
          }),
        })
      })
      await page.goto("http://127.0.0.1:4173/sources/revision-fixture/setup")
      await page.getByRole("button", { name: "Review transmission" }).click()
      await expect(page.getByRole("status")).toContainText("API credential missing")
      await expect(page.getByRole("button", { name: "Send", exact: true })).toBeDisabled()
      expect(missing.storage.counts()).toMatchObject({ grants: 0, jobs: 0, attempts: 0 })
      await page.getByRole("button", { name: "Cancel", exact: true }).click()
      await expect(page.getByRole("heading", { name: "Transmission cancelled" })).toBeVisible()
    } finally {
      await missing.close()
    }
  })

  test("rejects malformed JSON at the authenticated setup boundary", async ({ page }) => {
    const setupsBefore = fixture.storage.counts().setups
    const response = await page.request.post(`${fixture.origin}/api/study-setup/revision-fixture`, {
      headers: { origin: fixture.origin, "content-type": "application/json" },
      data: "{",
    })
    expect(response.status()).toBe(400)
    expect(fixture.storage.counts().setups).toBe(setupsBefore)
  })
})
