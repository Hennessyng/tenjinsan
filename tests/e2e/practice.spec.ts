import { mkdir, writeFile } from "node:fs/promises"
import { expect, test } from "@playwright/test"
import { practiceLesson, readerFixture } from "@reading-studio/reader/testing"

const evidence = ".omo/evidence/reading-studio/task-24"
test.describe("practice and book map", () => {
  let fixture: Awaited<ReturnType<typeof readerFixture>>
  test.beforeAll(async () => {
    await mkdir(evidence, { recursive: true })
    fixture = await readerFixture()
  })
  test.afterAll(async () => fixture.close())

  for (const width of [375, 768, 1280]) {
    test(`explores every option and chapter at ${width}`, async ({ browser }) => {
      // Given
      const context = await browser.newContext({ viewport: { width, height: 900 } })
      const page = await context.newPage()
      await page.goto(`${fixture.origin}/practice`)
      await page.screenshot({ path: `${evidence}/initial-${width}.png`, fullPage: true })
      // When / Then
      for (const exercise of practiceLesson.sections.flatMap((section) => section.practice)) {
        const card = page.locator(`[aria-labelledby="practice-listening-${exercise.id}"]`)
        await expect(card.getByRole("radio")).toHaveCount(exercise.options.length)
        for (const option of exercise.options) {
          const radio = card.locator(`input[value="${option.id}"]`)
          await radio.focus()
          await page.keyboard.press("Space")
          await expect(radio).toBeChecked()
          const feedback = card.locator(
            `[data-state="listening:practice:${exercise.id}:${option.id}"]`,
          )
          await expect(feedback).toBeVisible()
          await expect(feedback.locator('[lang="en"]').last()).toHaveText(option.feedback.en)
          await expect(feedback.locator('[lang="ja"]').last()).toHaveText(option.feedback.ja)
          await expect(card.locator(".practice-feedback:visible")).toHaveCount(1)
          await card.screenshot({ path: `${evidence}/${exercise.id}-${option.id}-${width}.png` })
        }
      }
      await expect(page.locator('[data-practice-kind="reply"]')).toContainText("fictional scene")
      await expect(page.locator('[data-practice-kind="reply"]')).toContainText("架空の場面")
      const reflection = page.locator('[data-practice-kind="reflection"]')
      const requests: string[] = []
      page.on("request", (request) => requests.push(request.url()))
      await reflection.getByRole("textbox").fill('<script>alert("private")</script> I need time.')
      await expect(reflection.getByRole("textbox")).toHaveValue(
        '<script>alert("private")</script> I need time.',
      )
      await expect(reflection.locator("form,output,[data-score]")).toHaveCount(0)
      await expect(reflection).toContainText("Not sent, saved or assessed")
      expect(requests).toEqual([])
      await reflection.screenshot({ path: `${evidence}/reflection-custom-${width}.png` })
      await page.getByRole("link", { name: "Open source context" }).first().click()
      await expect(page.locator("#sources-listening")).toBeFocused()
      await expect(page.locator("#sources-listening blockquote")).toHaveText(
        "A question can leave room for correction.",
      )
      await page.getByRole("link", { name: "Book map" }).click()
      await expect(page.locator('[data-coverage="covered"]')).toHaveCount(1)
      await expect(page.locator('[data-coverage="not-covered"]')).toHaveCount(2)
      await expect(page.locator('[data-coverage="not-covered"] a')).toHaveCount(0)
      await page.locator("#book-map").screenshot({ path: `${evidence}/map-${width}.png` })
      await page.locator('[data-coverage="covered"] a').click()
      await expect(page.locator("#section-listening")).toBeFocused()
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      )
      await page.screenshot({ path: `${evidence}/practice-${width}.png`, fullPage: true })
      await writeFile(
        `${evidence}/geometry-${width}.json`,
        JSON.stringify({ width, overflow: false, options: 7, covered: 1, notCovered: 2 }, null, 2),
      )
      if (width === 1280) {
        await page.screenshot({ path: `${evidence}/practice.png`, fullPage: true })
        await writeFile(`${evidence}/coverage.txt`, await page.locator("#book-map").innerText())
      }
      await context.close()
    })
  }

  test("keeps choices usable without scripts and all explanations in print", async ({
    browser,
  }) => {
    // Given
    const context = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width: 375, height: 900 },
    })
    const page = await context.newPage()
    await page.goto(`${fixture.origin}/practice`)
    // When
    await page.locator('[data-practice-kind="reply"] input').first().check()
    // Then
    await expect(
      page.locator('[data-practice-kind="reply"] .practice-feedback:visible'),
    ).toHaveCount(1)
    await page.screenshot({ path: `${evidence}/no-script.png`, fullPage: true })
    await page.emulateMedia({ media: "print" })
    await expect(page.locator(".practice-feedback:visible")).toHaveCount(7)
    await context.close()
  })
})
