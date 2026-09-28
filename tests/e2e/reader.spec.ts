import { mkdir, writeFile } from "node:fs/promises"
import { expect, test } from "@playwright/test"
import { lessons, publicationTeachingStateIds, readerFixture } from "@reading-studio/reader/testing"
import { measureReader } from "./reader-geometry.ts"

const evidence = ".omo/evidence/reading-studio/task-21"
test.describe("editorial reader", () => {
  let origin: string
  let fixture: Awaited<ReturnType<typeof readerFixture>>
  test.beforeAll(async () => {
    await mkdir(evidence, { recursive: true })
    fixture = await readerFixture()
    origin = fixture.origin
  })
  test.afterAll(async () => fixture.close())

  for (const width of [390, 768, 1280]) {
    for (const javaScriptEnabled of [true, false]) {
      test(`reads two lessons and primitives at ${width}px with JS ${javaScriptEnabled}`, async ({
        browser,
      }) => {
        // Given
        const context = await browser.newContext({
          viewport: { width, height: 900 },
          javaScriptEnabled,
        })
        const page = await context.newPage()
        const requests: string[] = []
        const measurements: Awaited<ReturnType<typeof measureReader>>[] = []
        page.on("request", (request) => requests.push(request.url()))
        // When
        for (const [index, path] of ["/", "/stress", "/showcase"].entries()) {
          await page.goto(`${origin}${path}`)
          // Then
          await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
          await expect(
            page.locator(
              "script:not([data-scene-runtime]):not([data-three-runtime]),img,iframe,[onerror],[onload]",
            ),
          ).toHaveCount(0)
          const lesson = lessons[index]
          if (lesson) {
            expect(
              await page
                .locator("[data-state]")
                .evaluateAll((elements) =>
                  elements.map((element) => element.getAttribute("data-state")).sort(),
                ),
            ).toEqual([...publicationTeachingStateIds(lesson)].sort())
            for (const state of await page.locator("[data-state]").all())
              await expect(state).toBeVisible()
          }
          const initial = await measureReader(page, path, "initial-paired")
          measurements.push(initial)
          expect(initial.overflow).toBe(false)
          expect(initial.textOverflows).toEqual([])
          await page.screenshot({
            path: `${evidence}/${index === 2 ? "showcase" : `lesson-${index}`}-${width}-js-${javaScriptEnabled}.png`,
            fullPage: true,
          })
          if (index === 0 && javaScriptEnabled && width !== 768)
            await page.screenshot({
              path: `${evidence}/${width === 390 ? "mobile" : "desktop"}.png`,
              fullPage: true,
            })
          for (const language of ["en", "ja", "paired"]) {
            await page.locator(`input[value="${language}"]`).check()
            await expect(page.locator(`input[value="${language}"]`)).toBeChecked()
            const opposite = language === "en" ? "ja" : "en"
            if (language !== "paired")
              await expect(page.locator(`.reading-content h1 [lang="${opposite}"]`)).toBeHidden()
            const measured = await measureReader(page, path, language)
            measurements.push(measured)
            expect(measured.overflow).toBe(false)
            expect(measured.textOverflows).toEqual([])
            await page.screenshot({
              path: `${evidence}/${index === 2 ? "showcase" : `lesson-${index}`}-${width}-js-${javaScriptEnabled}-${language}.png`,
              fullPage: true,
            })
          }
        }
        const externalRequests = requests.filter((url) => !url.startsWith(origin))
        expect(externalRequests).toEqual([])
        await writeFile(
          `${evidence}/geometry-${width}-js-${javaScriptEnabled}.json`,
          JSON.stringify(
            {
              width,
              javaScriptEnabled,
              measurements,
              externalRequests,
            },
            null,
            2,
          ),
        )
        await context.close()
      })
    }
  }

  test("navigates language, contents and source return using only keyboard with JS disabled", async ({
    browser,
  }) => {
    // Given
    const context = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width: 390, height: 900 },
    })
    const page = await context.newPage()
    await page.goto(origin)
    // When
    await page.keyboard.press("Tab")
    // Then
    await expect(page.getByRole("link", { name: "Skip to lesson" })).toBeFocused()
    await page.keyboard.press("Enter")
    await expect(page.locator("#reading")).toBeFocused()
    await page.goto(origin)
    await page.keyboard.press("Tab")
    await page.keyboard.press("Tab")
    await expect(page.locator('input[value="paired"]')).toBeFocused()
    await page.keyboard.press("ArrowRight")
    await expect(page.locator('input[value="en"]')).toBeChecked()
    await page.keyboard.press("ArrowRight")
    await expect(page.locator('input[value="ja"]')).toBeChecked()
    await page.keyboard.press("ArrowRight")
    await expect(page.locator('input[value="paired"]')).toBeChecked()
    await page.screenshot({ path: `${evidence}/keyboard-focus.png`, fullPage: true })
    await page.keyboard.press("Tab")
    await page.keyboard.press("Enter")
    await expect(page.locator("#section-attention")).toBeFocused()
    for (let step = 0; step < 20; step++) {
      await page.keyboard.press("Tab")
      if (
        await page
          .locator('#section-attention .chapter-nav a[href="#sources-attention"]')
          .evaluate((node) => node === document.activeElement)
      )
        break
    }
    await expect(
      page.locator('#section-attention .chapter-nav a[href="#sources-attention"]'),
    ).toBeFocused()
    await page.keyboard.press("Enter")
    await expect(page.locator("#sources-attention")).toBeFocused()
    await page.keyboard.press("Tab")
    await page.keyboard.press("Enter")
    await expect(page.locator("#section-attention")).toBeFocused()
    await context.close()
  })
})
