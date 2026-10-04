import type { Page } from "@playwright/test"

export async function measureReader(page: Page, surface: string, mode: string) {
  const geometry = await page.evaluate(() => {
    const texts = Array.from(document.querySelectorAll(".pair p, .pair-label > span"))
      .filter((element) => element.getClientRects().length > 0)
      .map((element) => {
        const box = element.getBoundingClientRect()
        const range = document.createRange()
        range.selectNodeContents(element)
        const lines = Array.from(range.getClientRects()).map((rect) => ({
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
        }))
        const node = element.firstChild
        let textLeft = box.right
        let textRight = box.left
        if (node instanceof Text) {
          for (const match of node.data.matchAll(/\S/gu)) {
            range.setStart(node, match.index)
            range.setEnd(node, match.index + match[0].length)
            const glyph = range.getBoundingClientRect()
            textLeft = Math.min(textLeft, glyph.left)
            textRight = Math.max(textRight, glyph.right)
          }
        }
        return {
          text: element.textContent,
          language: element.getAttribute("lang"),
          left: box.left,
          right: box.right,
          textLeft,
          textRight,
          lines,
        }
      })
    return { viewport: innerWidth, pageWidth: document.documentElement.scrollWidth, texts }
  })
  return {
    surface,
    mode,
    ...geometry,
    overflow: geometry.pageWidth > geometry.viewport,
    textOverflows: geometry.texts.filter(
      (text) => text.textLeft < text.left - 1 || text.textRight > text.right + 1,
    ),
  }
}
