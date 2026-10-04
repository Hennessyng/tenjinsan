import { execFile } from "node:child_process"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { promisify } from "node:util"
import { expect, test } from "@playwright/test"
import { exportHtml } from "@reading-studio/export/html"
import { exportPdf } from "@reading-studio/export/pdf"
import { exportPrint } from "@reading-studio/export/print"
import { approved } from "@reading-studio/export/testing"
import { printRevision } from "@reading-studio/export/testing/print"

const exec = promisify(execFile)
const title = { en: "How can asking change listening?", ja: "問いかけは聴き方をどう変えますか？" }
const revision = approved({ ...printRevision.projection, title })
const emptyRevision = approved({
  ...printRevision.projection,
  title,
  sections: printRevision.projection.sections.map((section) => ({
    ...section,
    practice: section.practice.map((exercise) => ({ ...exercise, kind: "reply" as const })),
  })),
})

test("Japanese title keeps its question ending on a readable 390px line", async ({ browser }) => {
  // Given: actual static reader and print compositions, without scripts.
  const evidence = ".omo/evidence/reading-studio/f3-repair/phrase-final"
  await mkdir(evidence, { recursive: true })
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    javaScriptEnabled: false,
  })
  try {
    for (const [kind, markup] of [
      ["reader", await exportHtml(revision)],
      ["print", await exportPrint(revision)],
    ] as const) {
      const page = await context.newPage()
      // When
      await page.setContent(markup)
      // Then: the final phrase is not split before か？.
      const lines = await page.locator('h1 [lang="ja"]').evaluate((element) => {
        const text = element.firstChild
        if (!text) throw new TypeError("Missing title text")
        return Array.from(element.textContent ?? "", (_, index) => {
          const range = document.createRange()
          range.setStart(text, index)
          range.setEnd(text, index + 1)
          return { top: range.getBoundingClientRect().top, character: text.textContent?.[index] }
        })
      })
      expect(lines.at(-3)?.top).toBe(lines.at(-2)?.top)
      expect(lines.at(-2)?.top).toBe(lines.at(-1)?.top)
      const breakIndex = lines.findIndex((line) => line.top !== lines[0]?.top)
      expect(breakIndex).toBeGreaterThan(0)
      expect(lines[breakIndex - 1]?.character).toBe("を")
      expect(lines[breakIndex]?.character).toBe("ど")
      await page.locator("h1").screenshot({ path: `${evidence}/fixture-${kind}-390-title.png` })
      await page.close()
    }
  } finally {
    await context.close()
  }
})

for (const javaScriptEnabled of [false, true]) {
  test(`source-note and contents questions retain Japanese phrases offline with scripts ${javaScriptEnabled}`, async ({
    browser,
  }) => {
    // Given: the same long question appears in a source note and a narrow contents rail.
    const directory = await mkdtemp(join(tmpdir(), "reading-source-phrases-"))
    const source = approved({
      ...printRevision.projection,
      sections: printRevision.projection.sections.map((section, index) =>
        index === 0
          ? {
              ...section,
              heading: {
                en: "An exceptionallylongunbrokenenglishheading for the source section",
                ja: title.ja,
              },
              sourceNotes: section.sourceNotes.map((note) => ({ ...note, title })),
            }
          : section,
      ),
    })
    const browserContext = await browser.newContext({ javaScriptEnabled })
    try {
      const file = join(directory, "study.html")
      await writeFile(file, await exportHtml(source))
      const page = await browserContext.newPage()
      for (const width of [390, 1280]) {
        // When: the real standalone file lays out without JavaScript at each width.
        await page.setViewportSize({ width, height: 900 })
        await page.goto(pathToFileURL(file).href)
        // Then: the final verb stays together in both representations, while long English reflows.
        for (const selector of [".sources h3 [lang=ja]", ".contents a.pair-label [lang=ja]"]) {
          const lines = await page
            .locator(selector)
            .first()
            .evaluate((element) => {
              const text = element.firstChild
              if (!text) throw new TypeError("Missing Japanese question")
              return Array.from(text.textContent ?? "", (_, index) => {
                const range = document.createRange()
                range.setStart(text, index)
                range.setEnd(text, index + 1)
                return range.getBoundingClientRect().top
              })
            })
          if (
            (width === 390 && selector.includes("h3")) ||
            (width === 1280 && selector.includes("contents"))
          )
            expect(new Set(lines).size, `${selector} at ${width}px`).toBeGreaterThan(1)
          expect(new Set(lines.slice(-6)).size).toBe(1)
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          width,
        )
        expect(
          await page
            .locator(".contents a.pair-label [lang=en]")
            .first()
            .evaluate((element) => element.getBoundingClientRect().right <= innerWidth),
        ).toBe(true)
        if (width === 390)
          await page
            .locator("#sources")
            .screenshot({ path: test.info().outputPath("source-390.png") })
        else
          await page
            .locator(".contents a.pair-label")
            .first()
            .screenshot({ path: test.info().outputPath("contents-1280.png") })
      }
    } finally {
      await browserContext.close()
      await rm(directory, { recursive: true, force: true })
    }
  })
}

test("print collection is omitted when empty and retains authored topic questions otherwise", async ({
  page,
}) => {
  // Given: approved revisions with and without topic practice.
  // When
  await page.setContent(await exportPrint(emptyRevision))
  // Then
  await expect(page.locator("#print-questions")).toHaveCount(0)
  await page.setContent(await exportPrint(printRevision))
  await expect(page.locator("#print-questions [data-question]")).toHaveCount(1)
})

test("PDF keeps bilingual headings and following content on the same page", async () => {
  // Given: a real Chromium PDF with empty curated practice.
  const directory = await mkdtemp(join(tmpdir(), "reading-f3-layout-"))
  try {
    // When
    await writeFile(join(directory, "lesson.pdf"), await exportPdf(emptyRevision))
    await exec("pdftotext", [
      "-layout",
      join(directory, "lesson.pdf"),
      join(directory, "lesson.txt"),
    ])
    const pages = (await readFile(join(directory, "lesson.txt"), "utf8"))
      .split("\f")
      .filter((page) => page.trim())
    // Then: heading pairs and their first source note stay together; no empty collection.
    for (const page of pages) {
      expect(page.includes("Curated question collection")).toBe(false)
      expect(page.includes("Sources appendix")).toBe(page.includes("出典付録"))
      expect(page.includes("How can asking change listening?")).toBe(page.includes(title.ja))
      expect(page.includes("Sources appendix") && !page.includes("Synthetic source")).toBe(false)
      if (page.includes("What could you ask?")) {
        expect(page).toContain("A question allows correction.")
      }
    }
    expect(
      pages.some((page) => page.includes("Synthetic source") && page.includes("架空の出典")),
    ).toBe(true)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
