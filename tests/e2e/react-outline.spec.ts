import { expect, test } from "@playwright/test"
import { briefFixture } from "./brief-fixture.ts"

test.describe("React outline approval", () => {
  let fixture: Awaited<ReturnType<typeof briefFixture>>
  test.beforeEach(async ({ page }) => {
    fixture = await briefFixture()
    const draft = fixture.storage.briefs.save({
      studyId: "study-fixture",
      expectedRevisionId: null,
      content: {
        originalQuestion: { en: "How can I listen with care?", ja: "どうすれば丁寧に聴けますか？" },
        refinedQuestion: null,
        questionChoice: "original",
        supportingQuestions: [{ en: "What gets in the way?", ja: "何が妨げになりますか？" }],
        purpose: "Practice careful listening",
        context: "A conversation at work",
        depth: "focused",
        language: "paired",
        spoilerPolicy: "avoid",
        exclusions: ["Diagnosis"],
      },
    })
    fixture.storage.briefs.decide({
      studyId: draft.studyId,
      revisionId: draft.id,
      action: "approve",
    })
    await page.goto(`${fixture.origin}/login`)
    await page.getByLabel("Email").fill(fixture.credentials.email)
    await page.getByLabel("Password").fill(fixture.credentials.password)
    await page.getByRole("button", { name: "Log in" }).click()
    await page.route(/\/api\/outlines\/.*$/, async (route) => {
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
    test(`approves and revises a fixture outline at ${width}px`, async ({ page }, testInfo) => {
      // Given: a current approved brief with fixture-only generation.
      await page.setViewportSize({ width, height: 900 })
      await page.goto("http://127.0.0.1:4173/outlines/study-fixture")
      await page.getByRole("button", { name: "Generate fixture outline" }).click()
      // When: the owner reviews and approves the generated sequence.
      await expect(page.getByRole("status")).toHaveText("Awaiting outline approval")
      await expect(page.getByText("Diagnosis", { exact: true })).toBeVisible()
      await page.getByRole("button", { name: "Approve outline" }).click()
      // Then: approval is persisted but no lesson job is started.
      await expect(page.getByRole("status")).toHaveText("Outline approved")
      await page.screenshot({
        path: testInfo.outputPath(`react-outline-${width}.png`),
        fullPage: true,
      })
      const first = fixture.storage.outlines.current("study-fixture")
      expect(first && fixture.storage.outlines.approved(first.draft.id)?.id).toBe(first?.draft.id)
      await page.getByLabel("Revision choice").selectOption("reverse-order")
      await page.getByRole("button", { name: "Apply selected revision" }).click()
      await expect(page.getByRole("status")).toHaveText("Awaiting outline approval")
      await expect(page.locator("article h3").first()).toHaveText("What gets in the way?")
      expect(first && fixture.storage.outlines.approved(first.draft.id)).toBeNull()
      expect(fixture.storage.counts()).toMatchObject({ lessons: 0, jobs: 0 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
    })
  }
})
