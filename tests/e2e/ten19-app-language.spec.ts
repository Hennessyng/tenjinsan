import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { expect, test } from "@playwright/test"
import { interviewFixture } from "@reading-studio/server/interview-fixture"
import { sourceViewerFixture } from "@reading-studio/server/source-viewer-fixture"

const evidence = join(
  process.cwd(),
  ".sisyphus/runs/TEN-19/evidence/app-language",
  crypto.randomUUID(),
)
test.beforeAll(async () => {
  await mkdir(evidence, { recursive: true })
})

test("language persists across reload and a reopened browser context without provider calls", async ({
  browser,
}) => {
  const fixture = await sourceViewerFixture({ studioAssets: true })
  const context = await browser.newContext()
  try {
    const page = await context.newPage()
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))
    await page.goto(`${fixture.origin}/?lang=fr`)
    await expect(page.getByRole("navigation", { name: "Reading route", exact: true })).toBeVisible()
    expect(await page.evaluate(() => localStorage.getItem("tenjinsan.ui-language"))).toBeNull()
    await page.getByRole("button", { name: "日本語", exact: true }).click()
    await expect(page.getByRole("navigation", { name: "読書ルート", exact: true })).toBeVisible()
    await page.reload()
    await expect(page.locator("html")).toHaveAttribute("lang", "ja")
    const reopened = await browser.newContext({ storageState: await context.storageState() })
    try {
      const next = await reopened.newPage()
      await next.goto(fixture.origin)
      await expect(next.getByRole("navigation", { name: "読書ルート", exact: true })).toBeVisible()
    } finally {
      await reopened.close()
    }
    for (const width of [375, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 })
      await page.screenshot({ path: join(evidence, `hall-ja-${width}.png`), fullPage: true })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
    }
    expect(errors).toEqual([])
  } finally {
    await context.close()
    await fixture.close()
  }
})

test("import draft is retained on Stay and discarded only after an accepted language switch", async ({
  browser,
}) => {
  const fixture = await sourceViewerFixture({ studioAssets: true })
  const context = await browser.newContext()
  try {
    const page = await context.newPage()
    const writes: string[] = []
    page.on("request", (request) => {
      if (request.method() !== "GET") writes.push(request.url())
    })
    await page.goto(`${fixture.origin}/imports`)
    await page.locator('input[type="file"]').setInputFiles({
      name: "unsaved.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Synthetic local draft"),
    })
    await page.getByRole("button", { name: "日本語", exact: true }).click()
    await expect(page.getByRole("dialog")).toBeVisible()
    for (const width of [375, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 })
      await page.screenshot({
        path: join(evidence, `unsaved-language-dialog-${width}.png`),
        fullPage: true,
      })
    }
    await expect(page.locator("html")).toHaveAttribute("lang", "en")
    expect(await page.evaluate(() => localStorage.getItem("tenjinsan.ui-language"))).toBeNull()
    await page.getByRole("button", { name: "Stay", exact: true }).click()
    expect(
      await page
        .locator('input[type="file"]')
        .evaluate((input: HTMLInputElement) => input.files?.length),
    ).toBe(1)
    await page.getByRole("button", { name: "日本語", exact: true }).click()
    await page.getByRole("button", { name: "Leave and discard", exact: true }).click()
    await expect(page.locator("html")).toHaveAttribute("lang", "ja")
    await expect(page.getByRole("heading", { name: "本を取り込む", exact: true })).toBeVisible()
    expect(
      await page
        .locator('input[type="file"]')
        .evaluate((input: HTMLInputElement) => input.files?.length),
    ).toBe(0)
    expect(writes).toEqual([])
    await page.screenshot({ path: join(evidence, "import-ja.png"), fullPage: true })
  } finally {
    await context.close()
    await fixture.close()
  }
})

test("explicit interview language links warn before navigation and ordinary links retain the accepted language", async ({
  browser,
}) => {
  const fixture = await interviewFixture({ studioAssets: true })
  const context = await browser.newContext()
  try {
    const step = fixture.definition.steps.find((candidate) => candidate.question.policy.custom)
    if (!step) throw new TypeError("Missing custom-answer fixture")
    const page = await context.newPage()
    await page.goto(
      `${fixture.origin}/interviews/${fixture.definition.studyId}?step=${step.question.id}&lang=en`,
    )
    await page.locator("textarea#custom").fill("Unsaved question response")
    await page.locator('.interview nav a[lang="ja"]').click()
    await expect(page.getByRole("dialog")).toBeVisible()
    expect(new URL(page.url()).searchParams.get("lang")).toBe("en")
    await page.getByRole("button", { name: "Stay", exact: true }).click()
    await expect(page.locator("textarea#custom")).toHaveValue("Unsaved question response")
    await page.locator('.interview nav a[lang="ja"]').click()
    await page.getByRole("button", { name: "Leave and discard", exact: true }).click()
    await expect(page.locator("html")).toHaveAttribute("lang", "ja")
    await expect(page.locator(".interview textarea#custom")).toBeVisible()
    const links = await page
      .locator('.interview a[href*="step="]:not([lang])')
      .evaluateAll((anchors) => anchors.map((anchor) => anchor.getAttribute("href")))
    expect(links.length).toBeGreaterThan(0)
    expect(links.filter((href) => !href?.includes("lang=ja"))).toEqual([])
  } finally {
    await context.close()
    await fixture.close()
  }
})

test.afterAll(() => {
  console.log(`TEN-19 app evidence: ${evidence}`)
})

test("failed preference writes apply the current language with an honest reset notice", async ({
  browser,
}) => {
  const fixture = await sourceViewerFixture({ studioAssets: true })
  const context = await browser.newContext()
  try {
    await context.addInitScript(() =>
      Object.defineProperty(Storage.prototype, "setItem", {
        value() {
          throw new DOMException("Synthetic quota", "QuotaExceededError")
        },
      }),
    )
    const page = await context.newPage()
    await page.goto(fixture.origin)
    await page.getByRole("button", { name: "日本語", exact: true }).click()
    await expect(page.locator("html")).toHaveAttribute("lang", "ja")
    await expect(page.locator(".language-switch [role=status]")).toContainText("開き直す")
    expect(await page.evaluate(() => localStorage.getItem("tenjinsan.ui-language"))).toBeNull()
    await page.reload()
    await expect(page.locator("html")).toHaveAttribute("lang", "en")
  } finally {
    await context.close()
    await fixture.close()
  }
})

test("failed preference reads fall back to English without blocking the app", async ({
  browser,
}) => {
  const fixture = await sourceViewerFixture({ studioAssets: true })
  const context = await browser.newContext()
  try {
    await context.addInitScript(() =>
      Object.defineProperty(Storage.prototype, "getItem", {
        value() {
          throw new DOMException("Synthetic denial", "SecurityError")
        },
      }),
    )
    const page = await context.newPage()
    await page.goto(fixture.origin)
    await expect(page.getByRole("navigation", { name: "Reading route", exact: true })).toBeVisible()
    await expect(page.locator("html")).toHaveAttribute("lang", "en")
  } finally {
    await context.close()
    await fixture.close()
  }
})

test("keyboard language activation and Escape retain the unsaved draft before confirmation", async ({
  browser,
}) => {
  const fixture = await sourceViewerFixture({ studioAssets: true })
  const context = await browser.newContext()
  try {
    const page = await context.newPage()
    await page.goto(`${fixture.origin}/imports`)
    await page.locator('input[type="file"]').setInputFiles({
      name: "keyboard-draft.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Synthetic draft"),
    })
    await page.getByRole("button", { name: "日本語", exact: true }).focus()
    await page.keyboard.press("Enter")
    await expect(page.getByRole("button", { name: "Stay", exact: true })).toBeFocused()
    const bounds = await page.getByRole("dialog").boundingBox()
    const viewport = page.viewportSize()
    if (!bounds || !viewport) throw new TypeError("Missing dialog geometry")
    expect(Math.abs(bounds.x + bounds.width / 2 - viewport.width / 2)).toBeLessThan(2)
    expect(Math.abs(bounds.y + bounds.height / 2 - viewport.height / 2)).toBeLessThan(2)
    expect(
      (await page.getByRole("button", { name: "Stay", exact: true }).boundingBox())?.height,
    ).toBeGreaterThanOrEqual(32)
    await page.keyboard.press("Escape")
    await expect(page.getByRole("dialog")).not.toBeVisible()
    await expect(page.locator("html")).toHaveAttribute("lang", "en")
    expect(
      await page
        .locator('input[type="file"]')
        .evaluate((input: HTMLInputElement) => input.files?.length),
    ).toBe(1)
    await page.getByRole("button", { name: "日本語", exact: true }).focus()
    await page.keyboard.press("Enter")
    await expect(page.getByRole("button", { name: "Stay", exact: true })).toBeFocused()
    await page.keyboard.press("Tab")
    await expect(page.getByRole("button", { name: "Leave and discard", exact: true })).toBeFocused()
    await page.keyboard.press("Enter")
    await expect(page.locator("html")).toHaveAttribute("lang", "ja")
    expect(
      await page
        .locator('input[type="file"]')
        .evaluate((input: HTMLInputElement) => input.files?.length),
    ).toBe(0)
  } finally {
    await context.close()
    await fixture.close()
  }
})
