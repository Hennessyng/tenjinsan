import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { expect, test } from "@playwright/test"
import { exportHtml } from "@reading-studio/export/html"
import { approved } from "@reading-studio/export/testing"

const evidence = join(
  process.cwd(),
  ".sisyphus/runs/TEN-19/evidence/offline-language",
  crypto.randomUUID(),
)
test.beforeAll(async () => {
  await mkdir(evidence, { recursive: true })
})

for (const ui of ["en", "ja", "en+ja"] as const) {
  for (const lessonLanguage of ["en", "ja", "paired"] as const) {
    test(`fixed ${ui} UI with ${lessonLanguage} lesson and no JavaScript`, async ({ browser }) => {
      // Given
      const file = join(evidence, `${ui.replace("+", "-")}-${lessonLanguage}.html`)
      await writeFile(file, await exportHtml(approved(), undefined, ui))
      const context = await browser.newContext({
        javaScriptEnabled: false,
        offline: true,
        viewport: { width: 1280, height: 900 },
      })
      try {
        const page = await context.newPage()
        const external: string[] = []
        page.on("request", (request) => {
          if (/^https?:/.test(request.url())) external.push(request.url())
        })
        await page.goto(pathToFileURL(file).href)
        // When
        await page.locator(`.language-controls input[value="${lessonLanguage}"]`).check()
        // Then
        for (const locale of ["en", "ja"] as const) {
          const title = page.locator(`.reading-content > h1 > [lang="${locale}"]`)
          if (lessonLanguage === "paired" || lessonLanguage === locale)
            await expect(title).toBeVisible()
          else await expect(title).toBeHidden()
          const label = page.locator(`.contents h2 > [data-ui-copy][lang="${locale}"]`)
          if (ui === "en+ja" || ui === locale) await expect(label).toBeVisible()
          else await expect(label).toHaveCount(0)
        }
        await expect(page.locator('select[name="exportUi"]')).toHaveCount(0)
        expect(external).toEqual([])
        for (const width of [375, 768, 1280]) {
          await page.setViewportSize({ width, height: 900 })
          await page.screenshot({
            path: join(evidence, `${ui.replace("+", "-")}-${lessonLanguage}-${width}.png`),
            fullPage: true,
          })
        }
        await page.emulateMedia({ media: "print" })
        await expect(page.locator('.reading-content > h1 > [lang="en"]')).toBeVisible()
        await expect(page.locator('.reading-content > h1 > [lang="ja"]')).toBeVisible()
      } finally {
        await context.close()
      }
    })
  }
}

test.afterAll(() => {
  console.log(`TEN-19 offline evidence: ${evidence}`)
})

test("practice option identifiers do not control lesson language", async ({ browser }) => {
  // Given
  const base = approved().projection
  const revision = approved({
    ...base,
    sections: base.sections.map((section) => ({
      ...section,
      practice: section.practice.map((exercise) => ({
        ...exercise,
        options: exercise.options.map((option, index) =>
          index === 0 ? { ...option, id: "en" } : option,
        ),
      })),
    })),
  })
  const file = join(evidence, "practice-language-isolation.html")
  await writeFile(file, await exportHtml(revision, undefined, "ja"))
  const context = await browser.newContext({ javaScriptEnabled: false, offline: true })
  try {
    const page = await context.newPage()
    await page.goto(pathToFileURL(file).href)
    // When
    await page.locator('.practice input[value="en"]').first().check()
    // Then
    await expect(page.locator('.language-controls input[value="paired"]')).toBeChecked()
    await expect(page.locator('.reading-content > h1 > [lang="en"]')).toBeVisible()
    await expect(page.locator('.reading-content > h1 > [lang="ja"]')).toBeVisible()
    await expect(page.locator('.contents h2 [data-ui-copy][lang="ja"]')).toBeVisible()
  } finally {
    await context.close()
  }
})
