import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { expect, test } from "@playwright/test"
import { publicationFixture } from "@reading-studio/server/publication-fixture"

const evidence = ".omo/evidence/reading-studio/task-29"
test.describe("revision studio UI", () => {
  let fixture: Awaited<ReturnType<typeof publicationFixture>>
  test.beforeEach(async ({ page }) => {
    fixture = await publicationFixture()
    await mkdir(evidence, { recursive: true })
    await page.goto(`${fixture.origin}/login`)
    await page.getByLabel("Email").fill(fixture.credentials.email)
    await page.getByLabel("Password").fill(fixture.credentials.password)
    await page.getByRole("button", { name: "Log in" }).click()
    await page.goto(`${fixture.origin}${fixture.path}`)
  })
  test.afterEach(async () => fixture.close())

  for (const width of [375, 768, 1280]) {
    test(`forks a second lens and keeps old HTML/PDF after editing the original at ${width}px`, async ({
      page,
    }) => {
      test.setTimeout(90_000)
      // Given
      await page.setViewportSize({ width, height: 900 })
      await page.getByRole("button", { name: "Publish /" }).click()
      await page.getByRole("button", { name: "Generate approved files" }).click()
      const originalFiles = new Map<
        string,
        { readonly href: string; readonly hash: string; readonly filename: string }
      >()
      for (const format of ["HTML", "PDF"]) {
        const link = page.getByRole("link", { name: `Download ${format} · version 1`, exact: true })
        const href = await link.getAttribute("href")
        if (!href) throw new TypeError("Missing versioned link")
        const downloadEvent = page.waitForEvent("download")
        await link.click()
        const download = await downloadEvent
        const path = await download.path()
        if (!path) throw new TypeError("Missing download")
        const bytes = await readFile(path)
        expect(bytes.length).toBeGreaterThan(100)
        expect(bytes.toString()).toContain(format === "PDF" ? "%PDF-" : "<!doctype html>")
        originalFiles.set(format, {
          href,
          filename: download.suggestedFilename(),
          hash: createHash("sha256").update(bytes).digest("hex"),
        })
      }
      // When
      await page.getByRole("link", { name: "Study revisions /" }).click()
      await page.screenshot({ path: `${evidence}/revision-${width}.png`, fullPage: true })
      await page.getByRole("button", { name: "Fork a second lens /" }).focus()
      await page.keyboard.press("Enter")
      await expect(page.getByRole("heading", { name: "Forked study /" })).toBeVisible()
      const forkId = new URL(page.url()).pathname.split("/").at(-1)
      expect(forkId).not.toBe("study-fixture")
      await page.screenshot({ path: `${evidence}/fork-${width}.png`, fullPage: true })
      await page.getByRole("link", { name: "Edit answers /" }).click()
      await page.getByLabel("Your own response").fill("A second lens on listening")
      await page.getByRole("button", { name: "Save custom response" }).click()
      await page.getByRole("link", { name: "Study revisions /" }).click()
      await page.getByRole("link", { name: "Original study /" }).click()
      await page.getByRole("link", { name: "Edit reading goal /" }).click()
      await page.getByLabel("Purpose / 読書の目的").fill("Read for a different original goal")
      await page.getByRole("button", { name: "Review brief /" }).click()
      await page.getByRole("link", { name: "Study revisions /" }).click()
      await page.getByRole("link", { name: "Versioned HTML / PDF" }).click()
      // Then
      await expect(page.getByRole("heading", { name: /Version 1.*Old version/ })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
      await page.screenshot({ path: `${evidence}/old-files-${width}.png`, fullPage: true })
      for (const [format, original] of originalFiles) {
        const link = page.getByRole("link", { name: `Download ${format} · version 1`, exact: true })
        await expect(link).toHaveAttribute("href", original.href)
        const responseEvent = page.waitForResponse(
          (response) => new URL(response.url()).pathname === original.href,
        )
        const downloadEvent = page.waitForEvent("download")
        await link.click()
        const download = await downloadEvent
        const response = await responseEvent
        expect(response.headers()["x-publication-state"]).toBe("stale")
        expect(download.suggestedFilename()).toBe(original.filename)
        const path = await download.path()
        if (!path) throw new TypeError("Missing old download")
        const bytes = await readFile(path)
        expect(createHash("sha256").update(bytes).digest("hex")).toBe(original.hash)
        if (width === 1280) await download.saveAs(`${evidence}/old-version.${format.toLowerCase()}`)
      }
      const fork = fixture.storage.interviews.latest(forkId)
      expect(fixture.storage.interviews.answers(fork?.id)).toHaveLength(1)
      expect(fixture.storage.interviews.answers("interview-fixture")).toHaveLength(0)
      await writeFile(
        `${evidence}/versioned-files-${width}.json`,
        JSON.stringify([...originalFiles], null, 2),
      )
    })

    test(`requires fresh consent after a visible provider change at ${width}px`, async ({
      page,
    }) => {
      // Given
      await page.setViewportSize({ width, height: 900 })
      await page.getByRole("link", { name: "Study revisions /" }).click()
      // When
      await page.getByLabel("Provider and model /").selectOption("anthropic")
      await page.getByRole("button", { name: "Review provider change /" }).click()
      // Then
      await expect(page.getByRole("heading", { name: "Fresh provider consent /" })).toBeVisible()
      await expect(page.getByRole("status")).toContainText("Fresh consent required")
      await expect(page.getByText("New provider analysis required", { exact: false })).toBeVisible()
      await expect(page.getByRole("heading", { name: /Old setup version/ })).toBeVisible()
      await expect(page.getByRole("link", { name: "Edit answers /" })).toHaveCount(0)
      expect(fixture.storage.counts().grants).toBe(0)
      await page.getByRole("button", { name: "Approve transmission /" }).focus()
      await page.screenshot({ path: `${evidence}/provider-consent-${width}.png`, fullPage: true })
      await page.keyboard.press("Enter")
      await expect(page.getByRole("status")).toContainText("Transmission approved")
      expect(fixture.storage.counts().grants).toBe(1)
      expect(fixture.storage.counts().jobs).toBe(0)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
      await page.screenshot({ path: `${evidence}/consented-${width}.png`, fullPage: true })
    })
  }
})
