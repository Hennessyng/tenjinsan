import { mkdir } from "node:fs/promises"
import { expect, test } from "@playwright/test"
import { evidenceFixture } from "@reading-studio/server/evidence-fixture"

test.describe("evidence and privacy gate", () => {
  let fixture: Awaited<ReturnType<typeof evidenceFixture>>
  test.beforeEach(async ({ page }) => {
    fixture = await evidenceFixture()
    await mkdir(".omo/evidence/reading-studio/task-20", { recursive: true })
    await page.goto(`${fixture.origin}/login`)
    await page.getByLabel("Email").fill(fixture.credentials.email)
    await page.getByLabel("Password").fill(fixture.credentials.password)
    await page.getByRole("button", { name: "Log in" }).click()
    await page.goto(`${fixture.origin}${fixture.path}`)
  })
  test.afterEach(async () => fixture.close())

  for (const width of [375, 768, 1280]) {
    test(`cleans a flagged example and previews only the projection at ${width}px`, async ({
      page,
    }) => {
      // Given
      await page.setViewportSize({ width, height: 900 })
      await expect(page.getByRole("button", { name: "Confirm privacy review" })).toBeDisabled()
      await page.screenshot({
        path: `.omo/evidence/reading-studio/task-20/flagged-${width}.png`,
        fullPage: true,
      })
      for (const category of ["support", "qualification", "translation", "visual"])
        await page
          .getByRole("button", { name: `Acknowledge ${category} uncertainty`, exact: true })
          .click()
      await expect(page.getByRole("button", { name: "Confirm privacy review" })).toBeDisabled()
      const previous = fixture.storage.reviews.current(fixture.lesson.id)
      // When
      await page.getByText("Inspect every projected value", { exact: false }).click()
      await page
        .locator("summary")
        .filter({ hasText: /^\/sections\/0\/content\/en$/u })
        .click()
      await page
        .getByLabel("Correct /sections/0/content/en", { exact: true })
        .fill("Ask a colleague what they heard.")
      const field = page.getByLabel("Correct /sections/0/content/en", { exact: true })
      await expect(field).toBeFocused()
      expect(
        await field.evaluate(
          (element) => element instanceof HTMLTextAreaElement && element.validity.valid,
        ),
      ).toBe(true)
      expect(await field.evaluate((element) => getComputedStyle(element).outlineColor)).toBe(
        "rgb(138, 61, 39)",
      )
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
      await page.screenshot({
        path: `.omo/evidence/reading-studio/task-20/correction-${width}.png`,
        fullPage: true,
      })
      await page
        .getByLabel("Correct /sections/0/content/en", { exact: true })
        .locator("..")
        .getByRole("button", { name: "Save correction" })
        .focus()
      await page.keyboard.press("Enter")
      // Then
      await expect(page.getByRole("button", { name: "Confirm privacy review" })).toBeEnabled()
      const current = fixture.storage.reviews.current(fixture.lesson.id)
      expect(current?.projectionHash).not.toBe(previous?.projectionHash)
      expect(current?.semantic.every((item) => item.status === "unresolved")).toBe(true)
      for (const category of ["support", "qualification", "translation", "visual"])
        await page
          .getByRole("button", { name: `Acknowledge ${category} uncertainty`, exact: true })
          .click()
      await page.getByRole("button", { name: "Confirm privacy review" }).click()
      await expect(page.getByRole("status")).toContainText("Ready for later publication approval")
      await page.screenshot({
        path: `.omo/evidence/reading-studio/task-20/cleaned-${width}.png`,
        fullPage: true,
      })
      await page.getByRole("link", { name: "Preview cleaned projection" }).click()
      await expect(
        page.getByText("Ask a colleague what they heard.", { exact: true }).first(),
      ).toBeVisible()
      await expect(
        page.getByText("Semantic uncertainty acknowledged, not verified truth."),
      ).toBeVisible()
      expect(await page.content()).not.toContain("Mira Canarystone")
      await expect(page.locator("form, script, img")).toHaveCount(0)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
      await page.screenshot({
        path: `.omo/evidence/reading-studio/task-20/preview-${width}.png`,
        fullPage: true,
      })
      if (width === 1280)
        await page.screenshot({
          path: ".omo/evidence/reading-studio/task-20/evidence.png",
          fullPage: true,
        })
    })
  }

  test("rejects broken sources, privacy overrides, stale tabs and foreign access", async ({
    page,
    browser,
  }) => {
    // Given
    const current = fixture.storage.reviews.current(fixture.lesson.id)
    if (!current) throw new TypeError("Missing review")
    const post = (form: Record<string, string>) =>
      page.request.post(`${fixture.origin}${fixture.path}`, {
        headers: { origin: fixture.origin },
        form,
      })
    // When / Then
    expect((await post({ expectedId: current.id, action: "privacy-reviewed" })).status()).toBe(409)
    expect(
      (
        await post({
          expectedId: current.id,
          action: "semantic",
          category: "privacy",
          status: "acknowledged",
        })
      ).status(),
    ).toBe(422)
    await post({
      expectedId: current.id,
      action: "replace-text",
      path: "/sections/0/sourceNotes/0/quotation",
      text: "Fabricated quote",
    })
    expect((await post({ expectedId: current.id, action: "privacy-reviewed" })).status()).toBe(409)
    await page.reload()
    await expect(page.getByRole("alert").filter({ hasText: "unsupported-quotation" })).toBeVisible()
    await page.getByRole("button", { name: "Acknowledge support uncertainty", exact: true }).click()
    await expect(page.getByRole("alert").filter({ hasText: "unsupported-quotation" })).toBeVisible()
    const foreign = await page.request.post(`${fixture.origin}${fixture.path}`, {
      headers: { origin: "https://foreign.invalid" },
      form: {},
    })
    expect(foreign.status()).toBe(403)
    expect(
      (await page.request.get(`${fixture.origin}/evidence/other/${fixture.lesson.id}`)).status(),
    ).toBe(404)
    const anonymous = await browser.newContext()
    expect((await anonymous.request.get(`${fixture.origin}${fixture.path}`)).status()).toBe(401)
    await anonymous.close()
  })

  test("invalidates review after a caption edit and preserves Keep private across refresh", async ({
    page,
  }) => {
    // Given
    let current = fixture.storage.reviews.current(fixture.lesson.id)
    if (!current) throw new TypeError("Missing review")
    const post = (form: Record<string, string>) =>
      page.request.post(`${fixture.origin}${fixture.path}`, {
        headers: { origin: fixture.origin },
        form,
      })
    await post({
      expectedId: current.id,
      action: "replace-text",
      path: "/sections/0/content/en",
      text: "Ask a colleague.",
    })
    await page.reload()
    for (const category of ["support", "qualification", "translation", "visual"])
      await page.getByRole("button", { name: `Mark ${category} reviewed`, exact: true }).click()
    await page.getByRole("button", { name: "Confirm privacy review" }).click()
    await expect(page.getByRole("status")).toContainText("Ready for later publication approval")
    current = fixture.storage.reviews.current(fixture.lesson.id)
    if (!current) throw new TypeError("Missing review")
    // When
    await post({
      expectedId: current.id,
      action: "replace-text",
      path: "/sections/0/scenes/0/captions/0/text/en",
      text: "A changed caption",
    })
    await page.reload()
    // Then
    await expect(page.getByRole("status")).toContainText("Review required")
    expect(fixture.storage.reviews.current(fixture.lesson.id)?.privacyReviewed).toBe(false)
    await page.getByRole("button", { name: "Keep private" }).click()
    await page.reload()
    await expect(page.getByRole("status")).toContainText("Kept private")
    expect(fixture.storage.counts()).toMatchObject({ publications: 0, jobs: 0 })
    await page.screenshot({
      path: ".omo/evidence/reading-studio/task-20/kept-private.png",
      fullPage: true,
    })
  })
})
