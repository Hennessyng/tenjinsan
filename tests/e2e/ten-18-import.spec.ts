import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { expect, type Page, test } from "@playwright/test"
import {
  docxFixture,
  epubEntries,
  pdfFixture,
  zipFixture,
} from "@reading-studio/ingestion/test-support"
import { uploadHarness } from "@reading-studio/server/upload-fixture"

let harness: Awaited<ReturnType<typeof uploadHarness>>
const evidence = process.env["TEN18_EVIDENCE_DIR"] ?? ".omo/evidence/TEN-18"
test.beforeAll(async () => {
  harness = await uploadHarness({ studioAssets: true, providerAvailable: true })
  await mkdir(evidence, { recursive: true })
})
test.afterAll(async () => {
  await harness?.close()
})

async function capture(page: Page, name: string) {
  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true)
    await page.screenshot({ path: join(evidence, `${name}-${width}.png`), fullPage: true })
  }
}

for (const fixture of [
  {
    format: "epub",
    media: "application/epub+zip",
    bytes: zipFixture(epubEntries),
    expected: "Archive safety fixture.",
  },
  {
    format: "docx",
    media: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    bytes: docxFixture(),
    expected: "Final cell",
  },
  {
    format: "txt",
    media: "text/plain",
    bytes: Buffer.from("Early 日本語\n\nMiddle\nFinal"),
    expected: "Middle",
  },
  {
    format: "pdf",
    media: "application/pdf",
    bytes: pdfFixture(["Early", "", "Final"]),
    expected: "Early",
  },
]) {
  test(`TEN-18 ${fixture.format} normal browser import reaches reading and reviewed text-only consent`, async ({
    page,
  }) => {
    // Given
    await page.goto(`${harness.origin}/imports`)
    await expect(page.getByLabel(/Choose EPUB/)).toBeVisible()
    if (fixture.format === "epub") await capture(page, "intake-empty")
    await page.getByLabel(/Choose EPUB/).setInputFiles({
      name: `synthetic.${fixture.format}`,
      mimeType: fixture.media,
      buffer: fixture.bytes,
    })
    // When
    const uploaded = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/imports/upload") && response.request().method() === "POST",
    )
    await page.getByRole("button", { name: "Import document", exact: true }).click()
    const response = await uploaded
    // Then
    expect(response.status()).toBe(202)
    expect(harness.sourceStorage.counts().attempts).toBe(0)
    await expect(
      page.getByRole("link", { name: "Read imported source", exact: true }),
    ).toBeVisible()
    await capture(page, `${fixture.format}-accepted`)
    await page.getByRole("link", { name: "Read imported source", exact: true }).click()
    await expect(page.locator("article")).toContainText(fixture.expected)
    await page.getByText("Coverage and edition details", { exact: true }).click()
    if (fixture.format === "pdf") {
      await expect(page.locator("article")).toContainText("PDF page 1")
      await expect(page.getByText(/Omitted: pdf\/page-2/)).toBeVisible()
    }
    if (fixture.format === "docx")
      await expect(page.getByText(/Omitted: word\/unsupported.xml/)).toBeVisible()
    await capture(page, `${fixture.format}-reader`)
    await page.getByRole("link", { name: "Set up a study", exact: true }).click()
    await expect(page.getByRole("radio", { name: /Whole document/ })).toBeChecked()
    await capture(page, `${fixture.format}-setup`)
    await page.getByRole("button", { name: "Review transmission", exact: true }).click()
    await expect(
      page.getByRole("heading", { name: "Review transmission", exact: true }),
    ).toBeVisible()
    await expect(page.getByText(/Original-file attachment unavailable/)).toBeVisible()
    await capture(page, `${fixture.format}-review`)
    await page.getByRole("button", { name: "Send", exact: true }).click()
    await expect(page.getByRole("heading", { name: /Transmission approved/ })).toBeVisible()
  })
}

test("TEN-18 malformed TXT is refused through the normal browser without a new source", async ({
  page,
}) => {
  // Given
  const before = harness.sourceStorage.counts()
  await page.goto(`${harness.origin}/imports`)
  await page.getByLabel(/Choose EPUB/).setInputFiles({
    name: "invalid.txt",
    mimeType: "text/plain",
    buffer: Buffer.from([0xc3, 0x28]),
  })
  // When
  const refusal = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/imports/upload") && response.request().method() === "POST",
  )
  await page.getByRole("button", { name: "Import document", exact: true }).click()
  // Then
  const response = await refusal
  expect(response.status()).toBe(422)
  expect(await response.json()).toMatchObject({ error: "invalid-encoding" })
  await expect(page.getByRole("alert")).toContainText("The text is not valid UTF-8.")
  expect(harness.sourceStorage.counts()).toEqual(before)
  await capture(page, "intake-refused")
})
