import { expect, test } from "@playwright/test"
import { approved } from "@reading-studio/export/testing"
import { pdfDocument } from "@reading-studio/export/testing/pdf"

test("paired PDF interface paragraphs do not strand a Japanese sentence ending after English", async ({
  page,
}) => {
  // Given
  await page.emulateMedia({ media: "print" })
  // When
  await page.setContent(await pdfDocument(approved(), undefined, "en+ja"))
  await page.evaluate(async () => {
    await document.fonts.ready
  })
  // Then
  const notice = page.locator('.scene-figure figcaption > p > [data-ui-copy][lang="ja"]').first()
  expect(
    await notice.evaluate((element) => {
      const range = document.createRange()
      range.selectNodeContents(element)
      return [...range.getClientRects()].filter((rect) => rect.width > 0).length
    }),
  ).toBe(1)
})
