import { join } from "node:path"
import { expect, type Page, test } from "@playwright/test"
import {
  docxFixture,
  epubEntries,
  pdfFixture,
  zipFixture,
} from "@reading-studio/ingestion/test-support"
import { sourceViewerFixture } from "@reading-studio/server/source-viewer-fixture"
import { uploadHarness } from "@reading-studio/server/upload-fixture"
import { z } from "zod"

const evidence = process.env["TEN22_EVIDENCE_DIR"]
let harness: Awaited<ReturnType<typeof uploadHarness>>
let references: Awaited<ReturnType<typeof sourceViewerFixture>>
test.beforeAll(async () => {
  harness = await uploadHarness({ studioAssets: true })
  references = await sourceViewerFixture({ studioAssets: true, providerAvailable: false })
})
test.afterAll(async () => {
  await harness?.close()
  await references?.close()
})
async function snapshot(page: Page, name: string) {
  if (!evidence) return
  const alert = page.getByRole("alert").first()
  if (await alert.count()) await alert.scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(evidence, `${name}.png`) })
}
async function choose(page: Page, text: string) {
  await page
    .locator("#epub-file")
    .setInputFiles({ name: "synthetic.txt", mimeType: "text/plain", buffer: Buffer.from(text) })
}
async function importText(page: Page, text: string) {
  await choose(page, text)
  const uploaded = page.waitForResponse((response) =>
    response.url().endsWith("/api/imports/upload"),
  )
  await page.getByRole("button", { name: "Import document", exact: true }).click()
  const receipt = z
    .object({ normalizationRevisionId: z.string() })
    .parse(await (await uploaded).json())
  await expect(page.getByRole("link", { name: "Read this book", exact: true })).toHaveAttribute(
    "href",
    `/sources/${receipt.normalizationRevisionId}`,
  )
}
const formats = [
  { format: "epub", mime: "application/epub+zip", buffer: zipFixture(epubEntries) },
  {
    format: "docx",
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: docxFixture(),
  },
  { format: "txt", mime: "text/plain", buffer: Buffer.from("TEN22 unique UTF8 日本語 source") },
  {
    format: "pdf",
    mime: "application/pdf",
    buffer: pdfFixture(["TEN22 first page", "", "TEN22 final page"]),
  },
] as const
for (const fixture of formats) {
  test(`TEN-22 readable ${fixture.format} retains exact source and requires explicit reading`, async ({
    page,
  }) => {
    // Given
    const posts: string[] = []
    page.on("request", (request) => {
      if (request.method() === "POST") posts.push(new URL(request.url()).pathname)
    })
    await page.goto(`${harness.origin}/imports?lang=en`)
    await page.locator("#epub-file").setInputFiles({
      name: `synthetic.${fixture.format}`,
      mimeType: fixture.mime,
      buffer: fixture.buffer,
    })
    // When
    const upload = page.waitForResponse((response) =>
      response.url().endsWith("/api/imports/upload"),
    )
    await page.getByRole("button", { name: "Import document", exact: true }).click()
    const receipt = z
      .object({ normalizationRevisionId: z.string() })
      .parse(await (await upload).json())
    // Then
    const read = page.getByRole("link", { name: "Read this book", exact: true })
    await expect(read).toHaveAttribute("href", `/sources/${receipt.normalizationRevisionId}`)
    await expect(page).toHaveURL(/\/imports\?lang=en$/)
    expect(posts).toEqual(["/api/imports/upload"])
    await read.focus()
    await page.keyboard.press("Enter")
    await expect(page).toHaveURL(
      new RegExp(`/sources/${receipt.normalizationRevisionId}\\?lang=en$`),
    )
    await expect(page.locator("#chapter-title")).toBeFocused()
    await expect(page.locator("#desk .room-plate .rn")).toHaveText("1")
    expect(posts.filter((path) => path === "/api/imports/upload")).toHaveLength(1)
    expect(
      posts.every((path) => ["/api/imports/upload", "/api/library-selection"].includes(path)),
    ).toBe(true)
    if (fixture.format === "pdf") {
      await expect(page.getByText(/partial coverage · 2 of 3 resources included/)).toBeVisible()
      await page.getByText("Coverage and edition details", { exact: true }).click()
      await expect(page.getByText(/no-selectable-text/)).toBeVisible()
    }
    await snapshot(page, `read-${fixture.format}`)
    await page.reload()
    await expect(page.locator("#chapter-title")).toBeFocused()
    await page.getByRole("button", { name: "Next room", exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/sources/${receipt.normalizationRevisionId}/setup`))
    await expect(page.getByRole("button", { name: "Send", exact: true })).toHaveCount(0)
  })
}
test("TEN-22 decline, failed switch, retry and failed later imports retain receipt and study identity", async ({
  page,
}) => {
  // Given
  await page.goto(`${harness.origin}/imports?lang=en`)
  await importText(page, "TEN22 first distinct selected book")
  await page.getByRole("link", { name: "Read this book", exact: true }).click()
  await expect(page.locator("#chapter-title")).toBeVisible()
  await page.getByRole("button", { name: "1. Import & read", exact: true }).click()
  await importText(page, "TEN22 second distinct selected book")
  const read = page.getByRole("link", { name: "Read this book", exact: true })
  const href = await read.getAttribute("href")
  if (!href) throw new TypeError("Missing source URL")
  const originalIdentity = await page.locator(".desk-foot .status").textContent()
  const declined = page.waitForEvent("dialog").then((dialog) => dialog.dismiss())
  // When
  await read.click()
  await declined
  // Then
  await expect(page).toHaveURL(/\/imports/)
  await expect(page.locator(".desk-foot .status")).toHaveText(originalIdentity ?? "")
  await page.route("**/api/library-selection", (route) =>
    route.fulfill({ status: 503, json: { error: "/private/secret" } }),
  )
  const failedSwitch = page.waitForEvent("dialog").then((dialog) => dialog.accept())
  await read.click()
  await failedSwitch
  await expect(page.getByRole("alert")).toContainText("Could not open")
  await expect(page.getByRole("alert")).not.toContainText("/private/")
  await expect(read).toHaveAttribute("href", href)
  await snapshot(page, "switch-failed")
  await page.unroute("**/api/library-selection")
  const confirmed = page.waitForEvent("dialog").then((dialog) => dialog.accept())
  await read.click()
  await confirmed
  await expect(page.locator("article")).toContainText("TEN22 second distinct selected book")
  await page.getByRole("button", { name: "1. Import & read", exact: true }).click()
  await choose(page, " ")
  await page.getByRole("button", { name: "Import document", exact: true }).click()
  await expect(page.getByRole("alert")).toContainText("The file has no readable text.")
  await expect(page.getByRole("heading", { name: "Earlier acceptance" })).toBeVisible()
  await expect(read).toHaveAttribute("href", href)
  await snapshot(page, "later-refused")
  await page.route("**/api/imports/upload", (route) => route.abort("failed"))
  await choose(page, "TEN22 interrupted")
  await page.getByRole("button", { name: "Import document", exact: true }).click()
  await expect(page.getByRole("alert")).toContainText("Import interrupted")
  await expect(read).toHaveAttribute("href", href)
  await snapshot(page, "later-interrupted")
})
for (const locale of ["en", "ja"] as const) {
  for (const width of [375, 768, 1280]) {
    test(`TEN-22 ${locale} shared room keyboard and layout at ${width}`, async ({ page }) => {
      // Given
      await page.emulateMedia({ reducedMotion: "reduce" })
      await page.setViewportSize({ width, height: width === 375 ? 420 : 800 })
      await page.goto(`${harness.origin}/imports?lang=${locale}`)
      // When / Then
      await expect(page.locator("#route button")).toHaveCount(9)
      await expect(page.locator("#epub-file")).toBeEnabled()
      await expect(page.locator(".intake-tray button")).toBeDisabled()
      await page.locator("#epub-file").focus()
      await expect(page.locator("#epub-file")).toBeFocused()
      await snapshot(page, `intake-${locale}-${width}`)
      expect(
        await page
          .locator("#desk")
          .evaluate((element) => element.scrollWidth - element.clientWidth),
      ).toBeLessThanOrEqual(1)
      expect(
        await page
          .locator(".desk-main")
          .evaluate((element) => element.scrollWidth - element.clientWidth),
      ).toBeLessThanOrEqual(1)
      await page.keyboard.press("Escape")
      await expect(page.locator("#library")).toHaveAttribute("data-mode", "hall")
      await expect(page.locator(".station .pin")).toHaveCount(9)
      await snapshot(page, `hall-${locale}-${width}`)
      await page.locator("#route button").first().click()
      await choose(page, "TEN22 unsaved choice")
      await page.locator(".desk-foot button").last().click()
      await expect(page.getByRole("dialog")).toBeVisible()
      await snapshot(page, `departure-${locale}-${width}`)
      await page.getByRole("dialog").getByRole("button").first().click()
      await expect(page.locator("#library")).toHaveAttribute("data-mode", "desk")
      await snapshot(page, `unsaved-${locale}-${width}`)
      await page.locator(".desk-foot button").last().click()
      await page.getByRole("dialog").getByRole("button").last().click()
      await page.goto(
        `${references.origin}/sources/revision-fixture?citation=${references.citation}&lang=${locale}`,
      )
      await expect(page.locator("mark")).toHaveText("A good question opens a door.")
      await expect(page.locator("#passage")).toBeFocused()
      expect(
        await page
          .locator(".desk-main")
          .evaluate((element) => element.scrollWidth - element.clientWidth),
      ).toBeLessThanOrEqual(1)
      await snapshot(page, `reader-${locale}-${width}`)
    })
  }
}
test("TEN-22 old citation, chapter, invalid and history URLs retain reader behavior", async ({
  page,
}) => {
  // Given
  await page.goto(
    `${references.origin}/sources/revision-fixture?citation=${references.citation}&lang=en`,
  )
  // When / Then
  await expect(page.locator("mark")).toHaveText("A good question opens a door.")
  await expect(page.locator("#passage")).toBeFocused()
  await snapshot(page, "citation")
  await page.getByRole("link", { name: "Chapter 2", exact: true }).click()
  await expect(page.locator("#chapter-title")).toHaveText("Chapter 2")
  await page.goBack()
  await expect(page.locator("mark")).toHaveText("A good question opens a door.")
  await page.reload()
  await expect(page.locator("#passage")).toBeFocused()
  await page.goto(`${references.origin}/sources/revision-fixture?chapter=2`)
  await expect(page.getByText(/This resource was excluded/)).toBeVisible()
  await snapshot(page, "excluded")
  await page.goto(`${references.origin}/sources/revision-fixture?citation=invalid`)
  await expect(page.getByRole("heading", { name: "Missing reference" })).toBeVisible()
  await snapshot(page, "missing-reference")
})
