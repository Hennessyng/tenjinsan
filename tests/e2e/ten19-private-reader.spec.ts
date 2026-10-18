import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { expect, test } from "@playwright/test"
import { changeEvidenceReview } from "@reading-studio/generation/review"
import { publicationFixture } from "@reading-studio/server/publication-fixture"

const evidence = join(
  process.cwd(),
  ".sisyphus/runs/TEN-19/evidence/private-reader",
  crypto.randomUUID(),
)
test.beforeAll(async () => {
  await mkdir(evidence, { recursive: true })
})

test("private reader resolves remembered Japanese on direct entry and explicit English wins", async ({
  browser,
}) => {
  const fixture = await publicationFixture()
  const context = await browser.newContext()
  try {
    await context.addInitScript(() => localStorage.setItem("tenjinsan.ui-language", "ja"))
    const page = await context.newPage()
    await page.goto(
      `${fixture.origin}/api/evidence/${fixture.lesson.studyId}/${fixture.lesson.id}/read`,
    )
    await expect(page.locator("html")).toHaveAttribute("lang", "ja")
    await expect(page.locator('.masthead a[href="#reading"]')).toHaveText("本文へ")
    for (const width of [375, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 })
      await page.screenshot({ path: join(evidence, `private-ja-${width}.png`), fullPage: true })
    }
    await page.goto(
      `${fixture.origin}/api/evidence/${fixture.lesson.studyId}/${fixture.lesson.id}/read?lang=en`,
    )
    await expect(page.locator("html")).toHaveAttribute("lang", "en")
    for (const width of [375, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 })
      await page.screenshot({ path: join(evidence, `private-en-${width}.png`), fullPage: true })
    }
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("tenjinsan.ui-language")))
      .toBe("en")
  } finally {
    await context.close()
    await fixture.close()
  }
})

test("private reader confirms before discarding reflection text and never writes workflow content", async ({
  browser,
}) => {
  const fixture = await publicationFixture()
  const context = await browser.newContext()
  try {
    const view = changeEvidenceReview(fixture.storage, fixture.lesson.id, {
      action: "correct",
      expectedId: fixture.view.draft.id,
      projection: {
        ...fixture.view.draft.projection,
        sections: fixture.view.draft.projection.sections.map((section) => ({
          ...section,
          practice: section.practice.map((exercise) => ({ ...exercise, kind: "reflection" })),
        })),
      },
    })
    const page = await context.newPage()
    const writes: string[] = []
    page.on("request", (request) => {
      if (request.method() !== "GET") writes.push(request.url())
    })
    await page.goto(
      `${fixture.origin}/api/evidence/${fixture.lesson.studyId}/${fixture.lesson.id}/read?lang=en`,
    )
    await page.locator(".practice textarea").first().fill("Unsaved reflection")
    await expect(page.getByRole("button", { name: "日本語", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "日本語", exact: true }).click()
    await expect(page.getByRole("dialog")).toBeVisible()
    expect(
      (await page.getByRole("button", { name: "Stay", exact: true }).boundingBox())?.height,
    ).toBeGreaterThanOrEqual(32)
    for (const width of [375, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 })
      await page.screenshot({
        path: join(evidence, `private-unsaved-dialog-${width}.png`),
        fullPage: false,
      })
    }
    await expect(page.locator("html")).toHaveAttribute("lang", "en")
    expect(await page.evaluate(() => localStorage.getItem("tenjinsan.ui-language"))).toBe("en")
    await page.getByRole("button", { name: "Stay", exact: true }).click()
    await expect(page.locator(".practice textarea").first()).toHaveValue("Unsaved reflection")
    await page.getByRole("button", { name: "日本語", exact: true }).click()
    await page.getByRole("button", { name: "Leave and discard", exact: true }).click()
    await expect(page.locator("html")).toHaveAttribute("lang", "ja")
    await expect(page.locator(".practice textarea").first()).toHaveValue("")
    expect(await page.evaluate(() => localStorage.getItem("tenjinsan.ui-language"))).toBe("ja")
    expect(fixture.storage.reviews.current(fixture.lesson.id)?.id).toBe(view.draft.id)
    expect(writes).toEqual([])
  } finally {
    await context.close()
    await fixture.close()
  }
})

test.afterAll(() => {
  console.log(`TEN-19 private-reader evidence: ${evidence}`)
})

test("private reader applies explicit Japanese with an honest notice when storage writes fail", async ({
  browser,
}) => {
  const fixture = await publicationFixture()
  const context = await browser.newContext({ viewport: { width: 375, height: 900 } })
  try {
    await context.addInitScript(() =>
      Object.defineProperty(Storage.prototype, "setItem", {
        value() {
          throw new DOMException("Synthetic quota", "QuotaExceededError")
        },
      }),
    )
    const page = await context.newPage()
    await page.goto(
      `${fixture.origin}/api/evidence/${fixture.lesson.studyId}/${fixture.lesson.id}/read?lang=ja`,
    )
    await expect(page.locator("html")).toHaveAttribute("lang", "ja")
    await expect(page.locator("#private-language-notice")).toBeVisible()
    await expect(page.locator("#private-language-notice")).toContainText("開き直す")
    expect(await page.evaluate(() => localStorage.getItem("tenjinsan.ui-language"))).toBeNull()
    await page.screenshot({ path: join(evidence, "private-write-failure-375.png"), fullPage: true })
  } finally {
    await context.close()
    await fixture.close()
  }
})

test("private reader falls back to English when remembered-choice reads fail", async ({
  browser,
}) => {
  const fixture = await publicationFixture()
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
    await page.goto(
      `${fixture.origin}/api/evidence/${fixture.lesson.studyId}/${fixture.lesson.id}/read`,
    )
    await expect(page.locator("html")).toHaveAttribute("lang", "en")
    await expect(page.locator('.masthead a[href="#reading"]')).toHaveText("Skip to lesson")
    await expect(page.locator("#private-language-controls")).toBeVisible()
  } finally {
    await context.close()
    await fixture.close()
  }
})
