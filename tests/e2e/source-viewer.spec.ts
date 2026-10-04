import { mkdir, writeFile } from "node:fs/promises"
import { expect, test } from "@playwright/test"
import { sourceViewerFixture } from "@reading-studio/server/source-viewer-fixture"

test.describe("source-viewer", () => {
  let fixture: Awaited<ReturnType<typeof sourceViewerFixture>>
  test.beforeAll(async () => {
    await mkdir(".omo/evidence/reading-studio/task-12", { recursive: true })
    fixture = await sourceViewerFixture()
  })
  test.afterAll(async () => {
    await fixture.close()
  })
  test.beforeEach(async ({ page }) => {
    await page.goto(`${fixture.origin}/login`)
    await page.getByLabel("Email").fill(fixture.credentials.email)
    await page.getByLabel("Password").fill(fixture.credentials.password)
    await page.getByRole("button", { name: "Log in" }).click()
    await expect(page.locator('[data-authenticated="true"]')).toBeVisible()
  })

  for (const width of [375, 768, 1280]) {
    test(`focuses a persisted citation with context at ${width}px`, async ({ page }) => {
      // Given: a real authenticated session and persisted source span.
      await page.setViewportSize({ width, height: 900 })
      // When
      await page.goto(`${fixture.origin}/sources/revision-fixture?citation=${fixture.citation}`)
      // Then
      await expect(page.locator("mark")).toHaveText("A good question opens a door.")
      await expect(page.locator("#passage")).toBeFocused()
      await expect(page.locator("mark")).toBeInViewport()
      const passage = await page.locator("#passage").boundingBox()
      const article = await page.locator("article").boundingBox()
      if (!passage || !article) throw new TypeError("Reader geometry unavailable")
      const outline = await page.locator("#passage").evaluate((element) => {
        const style = getComputedStyle(element)
        return Number.parseFloat(style.outlineWidth) + Number.parseFloat(style.outlineOffset)
      })
      expect(passage.x - outline).toBeGreaterThanOrEqual(article.x)
      expect(passage.x + passage.width + outline).toBeLessThanOrEqual(article.x + article.width)
      await writeFile(
        `.omo/evidence/reading-studio/task-12/geometry-${width}.json`,
        JSON.stringify({ passage, article, outline }, null, 2),
      )
      await expect(page.locator("#passage")).toContainText("Listen closely.")
      await expect(page.getByText("Page iv", { exact: true }).first()).toBeVisible()
      await expect(page.getByText("Partial coverage", { exact: true })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
      await mkdir(".omo/evidence/reading-studio/task-12", { recursive: true })
      await page.screenshot({
        path: `.omo/evidence/reading-studio/task-12/source-viewer-${width}.png`,
        fullPage: true,
      })
      if (width === 1280)
        await page.screenshot({
          path: ".omo/evidence/reading-studio/task-12/source-viewer.png",
          fullPage: true,
        })
    })
    test(`shows library, coverage, exclusion and missing states at ${width}px`, async ({
      page,
    }) => {
      // Given
      await page.setViewportSize({ width, height: 900 })
      // When
      await page.goto(`${fixture.origin}/sources`)
      // Then
      await expect(page.getByRole("heading", { name: "Your sources" })).toBeVisible()
      await expect(
        page.getByRole("link", { name: "The art of paying attention", exact: true }),
      ).toHaveCount(2)
      await page.screenshot({
        path: `.omo/evidence/reading-studio/task-12/library-${width}.png`,
        fullPage: true,
      })
      await page.goto(`${fixture.origin}/sources/revision-fixture?chapter=2`)
      await page.getByText("Coverage and edition details", { exact: true }).click()
      await expect(
        page.getByText("Excluded: appendix.xhtml — unsupported-media", { exact: true }),
      ).toBeVisible()
      await expect(page.getByText("This resource was excluded:", { exact: false })).toBeVisible()
      await page.screenshot({
        path: `.omo/evidence/reading-studio/task-12/excluded-${width}.png`,
        fullPage: true,
      })
      await page.goto(`${fixture.origin}/sources/revision-fixture?chapter=1`)
      await page.screenshot({
        path: `.omo/evidence/reading-studio/task-12/chapter-two-${width}.png`,
        fullPage: true,
      })
      await page.goto(`${fixture.origin}/sources/revision-fixture?citation=bad`)
      await page.screenshot({
        path: `.omo/evidence/reading-studio/task-12/missing-${width}.png`,
        fullPage: true,
      })
    })
  }

  test("navigates chapters by keyboard", async ({ page }) => {
    // Given
    await page.goto(`${fixture.origin}/sources/revision-fixture`)
    const chapter = page.getByRole("link", { name: "Chapter 2" })
    await chapter.focus()
    // When
    await page.keyboard.press("Enter")
    // Then
    await expect(page.getByRole("heading", { name: "Chapter 2", exact: true })).toBeVisible()
    await expect(page.getByText("Reading is a conversation across time.")).toBeVisible()
    await expect(page.getByText("Page label unavailable", { exact: true })).toBeVisible()
    await page.screenshot({
      path: ".omo/evidence/reading-studio/task-12/chapter-two.png",
      fullPage: true,
    })
  })

  test("shows accepted imports as queued, not normalized", async ({ page }) => {
    // Given / When
    await page.goto(`${fixture.origin}/sources`)
    // Then
    await expect(page.getByText("Awaiting normalization", { exact: true })).toBeVisible()
    await expect(page.getByText("import-pending", { exact: true })).toBeVisible()
    await expect(page.getByText("import-other-owner", { exact: true })).toHaveCount(0)
  })

  for (const query of [
    "citation=invalid",
    `citation=${"f".repeat(64)}`,
    "chapter=999",
    "chapter=https%3A%2F%2Fattacker.invalid%2Fprobe",
  ]) {
    test(`shows missing-reference without remote requests for ${query}`, async ({ page }) => {
      // Given
      const remote: string[] = []
      page.on("request", (request) => {
        if (new URL(request.url()).origin !== fixture.origin) remote.push(request.url())
      })
      // When
      const response = await page.goto(`${fixture.origin}/sources/revision-fixture?${query}`)
      // Then
      expect(response?.status()).toBe(404)
      await expect(page.getByRole("heading", { name: "Missing reference" })).toBeVisible()
      expect(remote).toEqual([])
      if (query === "citation=invalid")
        await page.screenshot({
          path: ".omo/evidence/reading-studio/task-12/invalid-link.png",
          fullPage: true,
        })
    })
  }

  test("renders hostile source markup only as text", async ({ page }) => {
    // Given
    const remote: string[] = []
    page.on("request", (request) => {
      if (new URL(request.url()).origin !== fixture.origin) remote.push(request.url())
    })
    // When
    await page.goto(`${fixture.origin}/sources/revision-fixture`)
    // Then
    await expect(page.locator("#unsafe")).toContainText('<img src="https://attacker.invalid/probe"')
    await expect(page.locator("img, iframe, object, embed, script")).toHaveCount(0)
    expect(remote).toEqual([])
  })

  test("refuses unowned revisions and cross-revision citations", async ({ page }) => {
    // Given / When
    const response = await page.goto(
      `${fixture.origin}/sources/foreign-revision?citation=${fixture.citation}`,
    )
    // Then
    expect(response?.status()).toBe(404)
    await expect(page.getByRole("heading", { name: "Missing reference" })).toBeVisible()
  })

  test("refuses a citation from another owned normalization", async ({ page }) => {
    // Given / When
    const response = await page.goto(
      `${fixture.origin}/sources/revision-other?citation=${fixture.citation}`,
    )
    // Then
    expect(response?.status()).toBe(404)
    await expect(page.getByRole("heading", { name: "Missing reference" })).toBeVisible()
  })

  test("requires authentication before returning source text", async ({ page }) => {
    // Given
    await page.context().clearCookies()
    // When
    const response = await page.goto(
      `${fixture.origin}/sources/revision-fixture?citation=${fixture.citation}`,
    )
    // Then
    expect(response?.status()).toBe(401)
    await expect(page.getByText("A good question opens a door.")).toHaveCount(0)
  })
})
