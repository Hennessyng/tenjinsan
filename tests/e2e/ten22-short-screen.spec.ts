import { expect, type Locator, test } from "@playwright/test"
import { uploadHarness } from "@reading-studio/server/upload-fixture"

async function expectWholeControl(target: Locator): Promise<void> {
  await target.scrollIntoViewIfNeeded()
  const result = await target.evaluate((element) => {
    const box = element.getBoundingClientRect()
    let top = 0
    let bottom = innerHeight
    let left = 0
    let right = innerWidth
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent)
      const bounds = parent.getBoundingClientRect()
      if (style.overflowY !== "visible") {
        top = Math.max(top, bounds.top)
        bottom = Math.min(bottom, bounds.bottom)
      }
      if (style.overflowX !== "visible") {
        left = Math.max(left, bounds.left)
        right = Math.min(right, bounds.right)
      }
    }
    const centre = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
    return {
      top: box.top,
      bottom: box.bottom,
      left: box.left,
      right: box.right,
      clipLeft: left,
      clipRight: right,
      clipTop: top,
      clipBottom: bottom,
      owns: centre !== null && element.contains(centre),
    }
  })
  expect(result.top).toBeGreaterThanOrEqual(result.clipTop - 1)
  expect(result.bottom).toBeLessThanOrEqual(result.clipBottom + 1)
  expect(result.left).toBeGreaterThanOrEqual(result.clipLeft - 1)
  expect(result.right).toBeLessThanOrEqual(result.clipRight + 1)
  expect(result.owns).toBe(true)
}
for (const locale of ["en", "ja"] as const) {
  for (const width of [375, 768, 1280]) {
    test(`TEN-22 ${locale} combined room keeps short-screen controls whole at ${width}`, async ({
      page,
    }) => {
      // Given
      const harness = await uploadHarness({ studioAssets: true })
      try {
        await page.emulateMedia({ reducedMotion: "reduce" })
        await page.setViewportSize({ width, height: 420 })
        await page.goto(`${harness.origin}/imports?lang=${locale}`)
        await expect(page.locator("#reading h1")).toHaveCount(1)
        // When / Then
        await expectWholeControl(page.locator("#epub-file"))
        await page.locator("#epub-file").setInputFiles({
          name: "synthetic.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("A short-screen synthetic source"),
        })
        await expectWholeControl(page.locator(".intake-tray button"))
        await page.locator(".intake-tray button").click()
        const read = page.locator(".intake-outcome-accepted a[data-source-open]")
        await expectWholeControl(read)
        await read.click()
        await expect(page.locator("#chapter-title")).toBeFocused()
        await expectWholeControl(page.locator("#chapter-title"))
        await expectWholeControl(page.locator("article p[tabindex]").first())
        await expectWholeControl(page.locator(".desk-foot .pager button").last())
        const filename = process.env["TEN22_EVIDENCE_DIR"]
        if (filename)
          await page.screenshot({ path: `${filename}/standalone-short-${locale}-${width}.png` })
      } finally {
        await harness.close()
      }
    })
  }
}
