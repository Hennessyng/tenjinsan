import { expect, test } from "@playwright/test"
import { briefFixture } from "./brief-fixture.ts"

test.describe("React reading brief", () => {
  let fixture: Awaited<ReturnType<typeof briefFixture>>
  test.beforeEach(async ({ page }) => {
    fixture = await briefFixture()
    await page.goto(`${fixture.origin}/login`)
    await page.getByLabel("Email").fill(fixture.credentials.email)
    await page.getByLabel("Password").fill(fixture.credentials.password)
    await page.getByRole("button", { name: "Log in" }).click()
    await page.route(/\/api\/briefs\/.*$/, async (route) => {
      const url = new URL(route.request().url())
      await route.fulfill({
        response: await route.fetch({
          url: `${fixture.origin}${url.pathname}${url.search}`,
          headers: { ...route.request().headers(), origin: fixture.origin },
        }),
      })
    })
  })
  test.afterEach(async () => {
    await fixture.close()
  })

  for (const width of [375, 768, 1280]) {
    test(`saves, defers and approves a revision at ${width}px`, async ({ page }, testInfo) => {
      // Given: an owner with a current setup and interview.
      await page.setViewportSize({ width, height: 900 })
      await page.goto("http://127.0.0.1:4173/briefs/study-fixture")
      await page.getByLabel("Original question (English)").fill("How can I listen with care?")
      await page
        .getByLabel("最初の問い（日本語）", { exact: true })
        .fill("どうすれば丁寧に聴けますか？")
      await page.getByLabel("Purpose / 読書の目的").fill("Practice careful listening")
      await page.getByLabel("Personal context / 個人的な背景").fill("A conversation at work")
      // When: a revision is saved for review.
      await page.getByRole("button", { name: "Review brief / 内容を確認" }).click()
      // Then: approval is a separate decision and no job was started.
      await expect(page.getByRole("status")).toContainText("Awaiting approval")
      await expect(page.getByRole("heading", { name: "Original vs refined" })).toBeVisible()
      expect(fixture.storage.counts()).toMatchObject({ approvals: 0, jobs: 0 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
      await page.getByRole("button", { name: "Defer / 保留する" }).click()
      await expect(page.getByRole("status")).toContainText("Decision deferred")
      await page.getByRole("button", { name: "Approve brief" }).click()
      await expect(page.getByRole("status")).toContainText("Brief approved")
      await page.screenshot({
        path: testInfo.outputPath(`react-brief-${width}.png`),
        fullPage: true,
      })
      expect(
        fixture.storage.briefs.approved(fixture.storage.briefs.current("study-fixture")?.draft.id)
          ?.guidingQuestion.en,
      ).toBe("How can I listen with care?")
      expect(fixture.storage.counts()).toMatchObject({ approvals: 1, jobs: 0 })
    })
  }

  test("a revision invalidates approval and stale approval is rejected", async ({ page }) => {
    await page.goto("http://127.0.0.1:4173/briefs/study-fixture")
    await page.getByLabel("Original question (English)").fill("Original question")
    await page.getByLabel("最初の問い（日本語）", { exact: true }).fill("最初の問い")
    await page.getByLabel("Purpose / 読書の目的").fill("Reading purpose")
    await page.getByLabel("Personal context / 個人的な背景").fill("Personal context")
    await page.getByRole("button", { name: "Review brief / 内容を確認" }).click()
    await expect(page.getByRole("status")).toContainText("Awaiting approval")
    const original = fixture.storage.briefs.current("study-fixture")?.draft.id
    await page.getByRole("button", { name: "Approve brief" }).click()
    await expect(page.getByRole("status")).toContainText("Brief approved")
    await page.getByRole("button", { name: "Revise / 修正する" }).click()
    await page.getByLabel("Refined question (English)").fill("Refined question")
    await page.getByLabel("練り直した問い（日本語）", { exact: true }).fill("練り直した問い")
    await page.getByLabel("Guiding question / 主となる問い").selectOption("refined")
    await page.getByRole("button", { name: "Review brief / 内容を確認" }).click()
    await expect(page.getByRole("status")).toContainText("Awaiting approval")
    expect(fixture.storage.briefs.approved(original)).toBeNull()
    await page.getByRole("button", { name: "Approve brief" }).click()
    await expect(page.getByRole("status")).toContainText("Brief approved")
    expect(
      fixture.storage.briefs.approved(fixture.storage.briefs.current("study-fixture")?.draft.id)
        ?.guidingQuestion.en,
    ).toBe("Refined question")
  })
})
