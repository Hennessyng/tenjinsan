import { expect, test } from "@playwright/test"
import { uploadHarness } from "@reading-studio/server/upload-fixture"

for (const language of ["en", "ja"] as const) {
  for (const width of [375, 768, 960, 1280]) {
    test(`${language} import controls fit their desk at ${width}px`, async ({ page }, testInfo) => {
      // Given
      const harness = await uploadHarness({ studioAssets: true })
      try {
        await page.setViewportSize({ width, height: 800 })
        await page.goto(`${harness.origin}/imports?lang=${language}`)
        const input = page.locator("#epub-file")
        await expect(input).toBeVisible()
        await page.locator("#desk").evaluate(async (desk) => {
          await Promise.all(
            desk.getAnimations({ subtree: true }).map((animation) => animation.finished),
          )
        })
        // When
        const dimensions = await page.locator(".import-book").evaluate((book) => {
          const form = book.querySelector("form")
          const paper = book.querySelector(".intake-paper")
          const note = book.querySelector(".intake-note")
          const parent = book.closest(".desk-main")
          if (!(form instanceof HTMLElement) || !paper || !note || !parent)
            throw new TypeError("Missing intake")
          const a = paper.getBoundingClientRect()
          const b = note.getBoundingClientRect()
          const pane = parent.getBoundingClientRect()
          return {
            overflow: Math.max(
              book.scrollWidth - book.clientWidth,
              form.scrollWidth - form.clientWidth,
            ),
            overlaps: !(
              a.right <= b.left + 1 ||
              b.right <= a.left + 1 ||
              a.bottom <= b.top + 1 ||
              b.bottom <= a.top + 1
            ),
            bookWidth: book.getBoundingClientRect().width,
            paperWidth: a.width,
            parentWidth: parent.clientWidth,
            edgesFit:
              a.left >= pane.left - 1 &&
              a.right <= pane.right + 1 &&
              b.left >= pane.left - 1 &&
              b.right <= pane.right + 1,
          }
        })
        // Then
        expect(dimensions.overflow).toBeLessThanOrEqual(1)
        expect(dimensions.overlaps).toBe(false)
        expect(dimensions.edgesFit).toBe(true)
        expect(dimensions.bookWidth).toBeGreaterThan(dimensions.parentWidth * 0.75)
        if (dimensions.bookWidth <= 640)
          expect(dimensions.paperWidth).toBeGreaterThan(dimensions.bookWidth * 0.75)
        await input.scrollIntoViewIfNeeded()
        await page.screenshot({ path: testInfo.outputPath("import.png") })
        await page.locator(".intake-note").scrollIntoViewIfNeeded()
        await page.screenshot({ path: testInfo.outputPath("note.png") })
      } finally {
        await harness.close()
      }
    })
  }
}
