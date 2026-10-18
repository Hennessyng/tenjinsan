import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { expect, type Page, test } from "@playwright/test"
import { DEFAULT_ARCHIVE_LIMITS } from "@reading-studio/ingestion/archive"
import { docxEntries, zipFixture } from "@reading-studio/ingestion/test-support"
import { uploadHarness } from "@reading-studio/server/upload-fixture"

let harness: Awaited<ReturnType<typeof uploadHarness>>
const evidence = process.env["TEN18_EVIDENCE_DIR"] ?? ".omo/evidence/TEN-18"
test.beforeAll(async () => {
  harness = await uploadHarness({
    studioAssets: true,
    providerAvailable: true,
    queueAnalysis: true,
    limits: DEFAULT_ARCHIVE_LIMITS,
  })
  await mkdir(evidence, { recursive: true })
})
test.afterAll(async () => {
  await harness?.close()
})

async function review(
  page: Page,
  input: { readonly name: string; readonly mimeType: string; readonly buffer: Buffer<ArrayBuffer> },
) {
  await page.goto(`${harness.origin}/imports`)
  await page.getByLabel(/Choose EPUB/).setInputFiles(input)
  await page.getByRole("button", { name: "Import document", exact: true }).click()
  await page.getByRole("link", { name: "Read imported source", exact: true }).click()
  await page.getByRole("link", { name: "Set up a study", exact: true }).click()
  await page.getByRole("button", { name: "Review transmission", exact: true }).click()
  await expect(
    page.getByRole("heading", { name: "Review transmission", exact: true }),
  ).toBeVisible()
}

test("blank DOCX paragraphs reach production queued analysis rather than a saved-grant failure", async ({
  page,
}) => {
  // Given
  const bytes = zipFixture(
    docxEntries.map((entry) =>
      entry.name === "word/document.xml"
        ? { ...entry, text: entry.text.replace("</w:p>", "</w:p><w:p/>") }
        : entry,
    ),
  )
  await review(page, {
    name: "blank-paragraph.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: bytes,
  })
  // When
  await page.getByRole("button", { name: "Send", exact: true }).click()
  // Then
  await expect(
    page.getByRole("heading", { name: "Transmission approved", exact: true }),
  ).toBeVisible()
  expect(harness.sourceStorage.counts()).toMatchObject({ grants: 1, jobs: 4, attempts: 0 })
  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    await page.screenshot({
      path: join(evidence, `repair-blank-docx-approved-${width}.png`),
      fullPage: true,
    })
  }
})

test("Japanese byte-limit refusal shows every unsent range before saving a grant", async ({
  page,
}) => {
  // Given
  await review(page, {
    name: "japanese-limit.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("あ".repeat(12_000)),
  })
  const before = harness.sourceStorage.counts()
  // When
  await page.getByRole("button", { name: "Send", exact: true }).click()
  // Then
  const alert = page.getByRole("alert")
  await expect(alert).toContainText("request-byte-limit")
  await expect(alert).toContainText("No grant was saved")
  await expect(alert.locator("li")).toHaveCount(1)
  await expect(alert.locator("li")).toContainText("UTF-16 [0, 12000)")
  expect(harness.sourceStorage.counts()).toEqual(before)
})

test("an oversized imported scope shows located unsent ranges and stays retryable without granting", async ({
  page,
}) => {
  // Given
  const text = "x".repeat(128 * 12_000 + 1)
  await review(page, { name: "over-window.txt", mimeType: "text/plain", buffer: Buffer.from(text) })
  const before = harness.sourceStorage.counts()
  // When
  await page.getByRole("button", { name: "Send", exact: true }).click()
  // Then
  const alert = page.getByRole("alert")
  await expect(alert).toContainText("analysis-window-limit")
  await expect(alert).toContainText("No grant was saved")
  await expect(alert.locator("li")).toHaveCount(Math.ceil(text.length / 100_000))
  await expect(alert.locator("li").first()).toContainText("UTF-16 [0, 100000)")
  await expect(alert.getByRole("link", { name: "Import a smaller document" })).toHaveAttribute(
    "href",
    "/imports",
  )
  expect(harness.sourceStorage.counts()).toEqual(before)
  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    await alert
      .getByRole("heading", { name: "Source preparation stopped" })
      .scrollIntoViewIfNeeded()
    expect(await alert.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    await page.screenshot({
      path: join(evidence, `repair-limit-head-${width}.png`),
      fullPage: true,
    })
    await alert.locator("li").last().scrollIntoViewIfNeeded()
    await page.screenshot({
      path: join(evidence, `repair-limit-tail-${width}.png`),
      fullPage: true,
    })
  }
  await page.getByRole("button", { name: "Send", exact: true }).click()
  await expect(page.getByRole("alert")).toContainText("analysis-window-limit")
  expect(harness.sourceStorage.counts()).toEqual(before)
  await page.reload()
  await expect(
    page.getByRole("heading", { name: "Review transmission", exact: true }),
  ).toBeVisible()
})
