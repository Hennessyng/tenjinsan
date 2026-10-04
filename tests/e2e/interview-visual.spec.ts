import { mkdir, writeFile } from "node:fs/promises"
import { expect, test } from "@playwright/test"
import { interviewFixture } from "@reading-studio/server/interview-fixture"

test("interview visual matrix covers every question, review and language", async ({
  page,
  browser,
}) => {
  // Given
  const fixture = await interviewFixture()
  const evidence = ".omo/evidence/reading-studio/task-16"
  await mkdir(evidence, { recursive: true })
  const captures: {
    readonly file: string
    readonly width: number
    readonly language: string
    readonly step: string
    readonly overflow: boolean
  }[] = []
  try {
    await page.goto(`${fixture.origin}/login`)
    await page.getByLabel("Email").fill(fixture.credentials.email)
    await page.getByLabel("Password").fill(fixture.credentials.password)
    await page.getByRole("button", { name: "Log in" }).click()
    // When / Then
    for (const width of [375, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 })
      for (const language of ["en", "ja"]) {
        for (const step of ["angle", "context", "decision", "extra", "~review"]) {
          await page.goto(
            `${fixture.origin}/interviews/study-fixture?step=${step}&lang=${language}`,
          )
          await page
            .locator("details")
            .first()
            .evaluate((element) => {
              element.setAttribute("open", "")
            })
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          )
          expect(overflow).toBe(false)
          const file = `matrix-${width}-${language}-${step.replace("~", "")}.png`
          await page.screenshot({ path: `${evidence}/${file}`, fullPage: true })
          captures.push({ file, width, language, step, overflow })
        }
      }
    }
    await page.goto(`${fixture.origin}/interviews`)
    await expect(page.getByRole("link", { name: /Where would you like/ })).toBeVisible()
    await page.screenshot({ path: `${evidence}/index.png`, fullPage: true })
    await page.goto(`${fixture.origin}/interviews/missing-study`)
    await expect(page.getByRole("heading", { name: /Interview unavailable/ })).toBeVisible()
    await page.screenshot({ path: `${evidence}/unavailable.png`, fullPage: true })
    const anonymous = await browser.newContext()
    try {
      expect((await anonymous.request.get(`${fixture.origin}/interviews`)).status()).toBe(401)
      expect(
        (await anonymous.request.get(`${fixture.origin}/interviews/study-fixture`)).status(),
      ).toBe(401)
    } finally {
      await anonymous.close()
    }
    await writeFile(
      `${evidence}/visual-matrix.json`,
      JSON.stringify(
        {
          captures,
          motion: "none",
          renderedBy: "Playwright Chromium; real authenticated Hono server and SQLite",
        },
        null,
        2,
      ),
    )
  } finally {
    await fixture.close()
  }
})
