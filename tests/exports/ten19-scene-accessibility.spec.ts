import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { expect, test } from "@playwright/test"
import { exportHtml } from "@reading-studio/export/html"
import { approved } from "@reading-studio/export/testing"

for (const ui of ["ja", "en+ja"] as const) {
  test(`scene seek accessible value uses fixed ${ui} interface text`, async ({ browser }) => {
    const root = join(
      process.cwd(),
      ".sisyphus/runs/TEN-19/evidence/review-fixes/scene-accessibility",
      crypto.randomUUID(),
    )
    await mkdir(root, { recursive: true })
    const file = join(root, `${ui.replace("+", "-")}.html`)
    await writeFile(file, await exportHtml(approved(), undefined, ui))
    const context = await browser.newContext({ offline: true })
    try {
      const page = await context.newPage()
      await page.goto(pathToFileURL(file).href)
      const seek = page.locator("input[data-seek]").first()
      await expect(seek).toBeVisible()
      await seek.focus()
      await page.keyboard.press("ArrowRight")
      await expect(seek).toHaveAttribute("aria-valuetext", /1 ミリ秒/)
      if (ui === "en+ja") await expect(seek).toHaveAttribute("aria-valuetext", /Milliseconds: 1/)
      else await expect(seek).not.toHaveAttribute("aria-valuetext", /\bms\b|milliseconds/i)
    } finally {
      await context.close()
    }
  })
}
