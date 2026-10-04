import { mkdir } from "node:fs/promises"
import { expect, test } from "@playwright/test"
import { sourceViewerFixture } from "@reading-studio/server/source-viewer-fixture"

test.describe("study-setup", () => {
  let fixture: Awaited<ReturnType<typeof sourceViewerFixture>>
  test.beforeAll(async () => {
    fixture = await sourceViewerFixture()
    await mkdir(".omo/evidence/reading-studio/task-13", { recursive: true })
  })
  test.afterAll(async () => fixture.close())
  test.beforeEach(async ({ page }) => {
    await page.goto(`${fixture.origin}/login`)
    await page.getByLabel("Email").fill(fixture.credentials.email)
    await page.getByLabel("Password").fill(fixture.credentials.password)
    await page.getByRole("button", { name: "Log in" }).click()
  })
  for (const width of [375, 768, 1280]) {
    test(`reviews partial source scope and cancels without approval at ${width}px`, async ({
      page,
    }) => {
      // Given
      await page.setViewportSize({ width, height: 900 })
      await page.goto(`${fixture.origin}/sources/revision-fixture`)
      await page.getByRole("link", { name: "Set up a study" }).click()
      await page.getByLabel("Provider and model").selectOption("anthropic")
      await page.getByLabel("Choose specific chapters").check()
      await page.getByLabel("chapter-one.xhtml", { exact: true }).check()
      await page.getByLabel("Provider and model").focus()
      await page.keyboard.press("Tab")
      const scopeChoice = page.getByLabel("Choose specific chapters")
      await expect(scopeChoice).toBeFocused()
      expect(await scopeChoice.evaluate((element) => getComputedStyle(element).outlineWidth)).toBe(
        "3px",
      )
      await page.screenshot({
        path: `.omo/evidence/reading-studio/task-13/choices-${width}.png`,
        fullPage: true,
      })
      // When
      await page.getByRole("button", { name: "Review transmission" }).click()
      // Then
      await expect(page.getByRole("heading", { name: "Review transmission" })).toBeVisible()
      await expect(page.locator("[data-selected]")).toContainText("chapter-one.xhtml")
      await expect(page.locator("[data-excluded]")).toContainText("chapter-two.xhtml")
      await page.getByRole("button", { name: "Send", exact: true }).focus()
      await page.keyboard.press("Tab")
      await expect(page.getByRole("button", { name: "Revise", exact: true })).toBeFocused()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
      await page.screenshot({
        path: `.omo/evidence/reading-studio/task-13/setup-${width}.png`,
        fullPage: true,
      })
      if (width === 1280)
        await page.screenshot({
          path: ".omo/evidence/reading-studio/task-13/setup.png",
          fullPage: true,
        })
      await page.getByRole("button", { name: "Cancel", exact: true }).click()
      await expect(page.getByRole("heading", { name: "Transmission cancelled" })).toBeVisible()
      await page.screenshot({
        path: `.omo/evidence/reading-studio/task-13/cancelled-${width}.png`,
        fullPage: true,
      })
    })
    test(`keeps missing-credential decisions safe and keyboard usable at ${width}px`, async ({
      page,
    }) => {
      // Given
      const missing = await sourceViewerFixture({ providerAvailable: false })
      try {
        await page.setViewportSize({ width, height: 900 })
        await page.goto(`${missing.origin}/login`)
        await page.getByLabel("Email").fill(missing.credentials.email)
        await page.getByLabel("Password").fill(missing.credentials.password)
        await page.getByRole("button", { name: "Log in" }).click()
        await page.goto(`${missing.origin}/sources/revision-fixture/setup`)
        await page.getByRole("button", { name: "Review transmission" }).click()
        // When / Then
        await expect(page.getByRole("status")).toBeVisible()
        await expect(page.getByRole("button", { name: "Send", exact: true })).toBeDisabled()
        await expect(page.getByRole("button", { name: "Revise", exact: true })).toBeEnabled()
        const rejected = await page.request.post(page.url(), {
          headers: { origin: missing.origin },
          form: { decision: "send" },
        })
        expect(rejected.status()).toBe(503)
        expect(missing.storage.counts()).toMatchObject({ grants: 0, attempts: 0, jobs: 0 })
        await page.getByRole("button", { name: "Revise", exact: true }).focus()
        await page.keyboard.press("Tab")
        await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeFocused()
        await page.screenshot({
          path: `.omo/evidence/reading-studio/task-13/missing-credentials-${width}.png`,
          fullPage: true,
        })
        await page.keyboard.press("Enter")
        await expect(page.getByRole("heading", { name: "Transmission cancelled" })).toBeVisible()
      } finally {
        await missing.close()
      }
    })
  }
  test("saves explicit consent only after Send and rejects a stale draft after revision", async ({
    page,
  }) => {
    // Given
    await page.goto(`${fixture.origin}/sources/revision-fixture/setup`)
    await page.getByRole("button", { name: "Review transmission" }).click()
    const stale = page.url()
    await page.getByRole("button", { name: "Revise", exact: true }).click()
    await page.getByLabel("Provider and model").selectOption("anthropic")
    await page.getByRole("button", { name: "Review transmission" }).click()
    const fresh = page.url()
    // When
    await page.goto(stale)
    // Then
    await expect(page.getByRole("heading", { name: "Setup unavailable" })).toBeVisible()
    await page.screenshot({
      path: ".omo/evidence/reading-studio/task-13/stale.png",
      fullPage: true,
    })
    await page.goto(fresh)
    await page.getByRole("button", { name: "Send", exact: true }).click()
    await expect(page.getByRole("heading", { name: "Transmission approved" })).toBeVisible()
    await expect(page.locator("[data-grant]")).toHaveAttribute("data-grant", /.+/)
    await page.screenshot({
      path: ".omo/evidence/reading-studio/task-13/approved.png",
      fullPage: true,
    })
  })
})
