import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { expect, test } from "@playwright/test"
import { exportHtml } from "@reading-studio/export/html"
import { exportPrint, printReadiness } from "@reading-studio/export/print"
import { printRevision } from "@reading-studio/export/testing/print"
import { Window } from "happy-dom"
import { assertStaticInventory, staticInventory } from "./html-inventory.ts"

const evidence = ".omo/evidence/reading-studio/task-26"
let directory: string
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "reading-print-"))
  await mkdir(evidence, { recursive: true })
  await writeFile(join(directory, "preview.html"), await exportHtml(printRevision))
})
test.afterAll(async () => {
  await rm(directory, { recursive: true, force: true })
})

for (const mode of ["initial", "changed-preview", "no-script"] as const) {
  test(`print: independent actual DOM in ${mode}`, async ({ browser }) => {
    // Given
    const context = await browser.newContext({
      javaScriptEnabled: mode !== "no-script",
      offline: true,
    })
    try {
      const preview = await context.newPage()
      await preview.goto(pathToFileURL(join(directory, "preview.html")).href)
      if (mode === "changed-preview") {
        await preview.locator('[data-select-state="compare:variant:second"]').click()
        await preview.locator('[data-view="spatial:viewpoint:second"]').click()
        await preview.locator('.practice input[type="radio"]').last().check()
        await preview.locator('input[name="reader-language"][value="ja"]').check()
      }
      // When: composition receives the approved revision, never the preview DOM.
      const output = await exportPrint(printRevision)
      const path = join(directory, `${mode}.html`)
      await writeFile(path, output)
      await writeFile(`${evidence}/print.html`, output)
      const page = await context.newPage()
      await page.emulateMedia({ media: "print" })
      await page.goto(pathToFileURL(path).href)
      // Then: IDs, labels and feedback are independent of production enumerators.
      await assertStaticInventory(page)
      for (const [id] of staticInventory) {
        const labels = id.endsWith(":first")
          ? ["First view", "最初の視点"]
          : id.endsWith(":second")
            ? ["Second view", "別の視点"]
            : id.endsWith(":ask")
              ? ["Ask", "尋ねる"]
              : ["Guess", "推測する"]
        await expect(page.locator(`[data-state="${id}"] > h4 > span`)).toHaveText(labels)
      }
      await expect(page.locator("script, input, button, canvas, textarea")).toHaveCount(0)
      await expect(page.locator("[data-static-view]")).toHaveCount(4)
      await expect(page.locator("[data-question] > h3 > span")).toHaveText([
        "What could you ask?",
        "何を尋ねますか？",
      ])
      await expect(page.locator("[data-question] > ol > li > .pair > p")).toHaveText([
        "Ask",
        "尋ねる",
        "A question allows correction.",
        "質問は訂正の余地を残します。",
        "Guess",
        "推測する",
        "A guess is not evidence.",
        "推測は根拠ではありません。",
      ])
      await expect(page.locator("#print-sources blockquote")).toHaveText(
        "An exact synthetic quotation.",
      )
      await expect(page.locator("#print-sources .locator")).toHaveText("chapter-one / paragraph 2")
      await expect(page.locator("#print-sources li > .pair > p")).toHaveText([
        "Distinguish evidence from interpretation.",
        "根拠と解釈を区別します。",
      ])
      for (const width of [375, 768, 1280]) {
        await page.setViewportSize({ width, height: 900 })
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        )
        for (const target of [
          "h1",
          "#scene-compare",
          "#scene-spatial",
          "#print-questions",
          "#print-sources",
        ]) {
          await page.locator(target).scrollIntoViewIfNeeded()
          await page.screenshot({
            path: `${evidence}/${mode}-${width}-${target.replaceAll("#", "")}.png`,
          })
        }
      }
      const window = new Window()
      window.document.write(await page.content())
      expect(printReadiness(printRevision, window.document).ready).toBe(true)
      await window.happyDOM.close()
    } finally {
      await context.close()
    }
  })
}

test("print: complete declared manifest cannot conceal omissions in actual DOM", async ({
  page,
}) => {
  // Given
  await page.setContent(await exportPrint(printRevision))
  const original = await page.content()
  const targets = staticInventory.flatMap(([id]) => [
    `[data-state="${id}"]`,
    ...["en", "ja"].flatMap((language) => [
      `[data-state="${id}"] > h4 > [lang="${language}"]`,
      `[data-state="${id}"] > .pair > [lang="${language}"]`,
    ]),
  ])
  targets.push(
    "#scene-compare svg > g:first-of-type [data-scene-mark]",
    '[data-static-view="spatial:viewpoint:second"] [data-static-object="1"]',
    "#scene-process [data-loop-arrow]",
    '[data-static-view="spatial:viewpoint:second"]',
    '[data-static-view="perspective:viewpoint:second"]',
    "[data-question]",
    "#print-sources blockquote",
  )
  for (const selector of targets) {
    await page.setContent(original)
    const manifest = await page
      .locator("[data-print-states]")
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-print-states")))
    // When
    await page.locator(selector).evaluate((node) => node.remove())
    // Then
    expect(
      await page
        .locator("[data-print-states]")
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-print-states"))),
    ).toEqual(manifest)
    const window = new Window()
    window.document.write(await page.content())
    expect(printReadiness(printRevision, window.document).ready, selector).toBe(false)
    await window.happyDOM.close()
  }
})
