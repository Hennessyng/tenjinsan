import { mkdir, readFile, writeFile } from "node:fs/promises"
import { expect, test } from "@playwright/test"
import { publicationFixture } from "@reading-studio/server/publication-fixture"

test.describe("publication approval and versioned downloads", () => {
  test.describe.configure({ mode: "serial" })
  let fixture: Awaited<ReturnType<typeof publicationFixture>>
  test.beforeEach(async ({ page }) => {
    fixture = await publicationFixture()
    await mkdir(".omo/evidence/reading-studio/task-28", { recursive: true })
    await page.goto(`${fixture.origin}/login`)
    await page.getByLabel("Email").fill(fixture.credentials.email)
    await page.getByLabel("Password").fill(fixture.credentials.password)
    await page.getByRole("button", { name: "Log in" }).click()
    await page.goto(`${fixture.origin}${fixture.path}`)
  })
  test.afterEach(async () => fixture.close())

  for (const width of [375, 768, 1280])
    test(`approves cleaned content and downloads both real formats at ${width}px`, async ({
      page,
    }) => {
      test.setTimeout(90_000)
      // Given
      await page.setViewportSize({ width, height: 900 })
      expect(await page.content()).not.toContain("Mira Canarystone")
      await expect(page.getByRole("button", { name: "Publish /" })).toBeEnabled()
      await page.screenshot({
        path: `.omo/evidence/reading-studio/task-28/review-${width}.png`,
        fullPage: true,
      })
      // When
      await page.getByRole("button", { name: "Publish /" }).focus()
      await page.keyboard.press("Enter")
      await expect(page.getByRole("button", { name: "Generate approved files" })).toBeVisible()
      await page.screenshot({
        path: `.omo/evidence/reading-studio/task-28/queued-${width}.png`,
        fullPage: true,
      })
      await page.getByRole("button", { name: "Generate approved files" }).click()
      // Then
      await expect(page.getByRole("link", { name: "Download HTML" })).toBeVisible()
      await expect(page.getByRole("link", { name: "Download PDF" })).toBeVisible()
      for (const format of ["HTML", "PDF"]) {
        const pending = page.waitForEvent("download")
        await page.getByRole("link", { name: `Download ${format}` }).click()
        const download = await pending
        const path = await download.path()
        if (!path) throw new TypeError("Missing actual download")
        const bytes = await readFile(path)
        expect(bytes.length).toBeGreaterThan(100)
        expect(bytes.toString()).not.toContain("Mira Canarystone")
        expect(bytes.toString()).toContain(format === "PDF" ? "%PDF-" : "Ask a colleague")
        if (width === 1280)
          await download.saveAs(
            `.omo/evidence/reading-studio/task-28/publication.${format.toLowerCase()}`,
          )
        expect(download.suggestedFilename()).toMatch(
          new RegExp(`^publication-.+\\.${format.toLowerCase()}$`),
        )
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
      await page.screenshot({
        path: `.omo/evidence/reading-studio/task-28/publication-${width}.png`,
        fullPage: true,
      })
      if (width === 1280) {
        await page.screenshot({
          path: ".omo/evidence/reading-studio/task-28/publication.png",
          fullPage: true,
        })
        const snapshots = fixture.storage.publicationOutputs.list(fixture.lesson.studyId)
        await writeFile(
          ".omo/evidence/reading-studio/task-28/manifests.json",
          JSON.stringify(
            snapshots.map(({ publication }) => ({
              id: publication.id,
              approval: publication.approval,
              outputs: fixture.storage.publicationOutputs.outputs(publication.id),
            })),
            null,
            2,
          ),
        )
      }
      await page.getByRole("button", { name: "Keep private /" }).click()
      await expect(page.getByRole("status")).toContainText("Kept private")
      await expect(page.getByRole("heading", { name: /Old version/ })).toBeVisible()
      await expect(page.getByRole("link", { name: "Download HTML" })).toBeVisible()
      await expect(page.getByRole("button", { name: "Publish /" })).toBeDisabled()
      await page.screenshot({
        path: `.omo/evidence/reading-studio/task-28/stale-${width}.png`,
        fullPage: true,
      })
    })

  test("stale browser approval cannot publish after Revise", async ({ page, context }) => {
    // Given
    const stale = await context.newPage()
    await stale.goto(`${fixture.origin}${fixture.path}`)
    await page.getByRole("button", { name: "Revise /" }).click()
    // When
    const response = stale.waitForResponse(
      (reply) => reply.request().method() === "POST" && reply.url().includes("/publications/"),
      { timeout: 10_000 },
    )
    await stale.getByRole("button", { name: "Publish /" }).click({ timeout: 10_000 })
    // Then
    expect((await response).status()).toBe(409)
    expect(fixture.storage.counts().publications).toBe(0)
    await stale.close()
  })

  for (const width of [375, 768, 1280])
    test(`shows output errors without successful download links at ${width}px`, async ({
      page,
    }) => {
      // Given
      await page.setViewportSize({ width, height: 900 })
      await page.getByRole("button", { name: "Publish /" }).click()
      const snapshot = fixture.storage.publicationOutputs.list(fixture.lesson.studyId)[0]
      if (!snapshot) throw new TypeError("Missing approval")
      for (const output of fixture.storage.publicationOutputs.outputs(snapshot.publication.id))
        fixture.storage.publicationOutputs.fail(output.id, "render-error")
      // When
      await page.reload()
      // Then
      await expect(page.getByText("HTML — Error", { exact: false })).toBeVisible()
      await expect(page.getByRole("link", { name: /Download/ })).toHaveCount(0)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
      await page.screenshot({
        path: `.omo/evidence/reading-studio/task-28/error-${width}.png`,
        fullPage: true,
      })
      await page.getByRole("button", { name: "Revise /" }).click()
      await expect(page.getByRole("heading", { name: "Evidence and privacy" })).toBeVisible()
    })
})
