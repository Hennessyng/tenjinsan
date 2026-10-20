import { join } from "node:path"
import { expect, type Page, test } from "@playwright/test"
import { uploadHarness } from "@reading-studio/server/upload-fixture"
import { z } from "zod"

const evidence = process.env["TEN22_EVIDENCE_DIR"]

async function upload(page: Page, text: string) {
  await page
    .locator("#epub-file")
    .setInputFiles({ name: "synthetic.txt", mimeType: "text/plain", buffer: Buffer.from(text) })
  const response = page.waitForResponse((value) => value.url().endsWith("/api/imports/upload"))
  await page.getByRole("button", { name: "Import document", exact: true }).click()
  await response
  await expect(page.locator(".intake-outcome-accepted")).toBeVisible()
}
test("TEN-22 importing during reading preserves passage identity and focus", async ({ page }) => {
  // Given
  const harness = await uploadHarness({ studioAssets: true })
  try {
    await page.goto(`${harness.origin}/imports?lang=en`)
    await upload(page, "Original passage stays put")
    await page.getByRole("link", { name: "Read this book", exact: true }).click()
    await expect(page.locator("article")).toContainText("Original passage stays put")
    await page.getByText("Import another book / retained import receipt", { exact: true }).click()
    const requests: string[] = []
    page.on("request", (request) => {
      if (request.url().includes("/api/source-reader/")) requests.push(request.url())
    })
    // When
    await upload(page, "A new source must not reset current reading")
    // Then
    await expect(page.locator(".intake-outcome-accepted")).toBeFocused()
    await expect(page.locator("article")).toContainText("Original passage stays put")
    expect(requests).toEqual([])
    if (evidence)
      await page.screenshot({ path: join(evidence, "receipt-focus-during-reading.png") })
  } finally {
    await harness.close()
  }
})
test("TEN-22 Read this book obeys Stay and Leave for a newly chosen unsaved file", async ({
  page,
}) => {
  // Given
  const harness = await uploadHarness({ studioAssets: true })
  try {
    await page.goto(`${harness.origin}/imports?lang=en`)
    await upload(page, "Retained source for unsaved link departure")
    await page.locator("#epub-file").setInputFiles({
      name: "unsaved.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Not imported"),
    })
    const read = page.getByRole("link", { name: "Read this book", exact: true })
    // When
    await read.click()
    // Then
    await expect(page.getByRole("dialog", { name: "Unsaved changes", exact: true })).toBeVisible()
    if (evidence) await page.screenshot({ path: join(evidence, "read-link-unsaved-departure.png") })
    await page.getByRole("button", { name: "Stay", exact: true }).click()
    await expect(page).toHaveURL(/\/imports/)
    expect(
      await page
        .locator("#epub-file")
        .evaluate((input) =>
          input instanceof HTMLInputElement ? input.files?.item(0)?.name : null,
        ),
    ).toBe("unsaved.txt")
    await read.click()
    await page.getByRole("button", { name: "Leave and discard", exact: true }).click()
    await expect(page.locator("article")).toContainText(
      "Retained source for unsaved link departure",
    )
  } finally {
    await harness.close()
  }
})

test("TEN-22 repeated imports open a stable study with no prior selection", async ({ page }) => {
  // Given
  const harness = await uploadHarness({ studioAssets: true })
  try {
    await page.goto(`${harness.origin}/imports?lang=en`)
    await upload(page, "Duplicate source with multiple saved studies")
    await upload(page, "Duplicate source with multiple saved studies")
    const context = z
      .object({ studies: z.array(z.object({ id: z.string() })) })
      .parse(await (await page.request.get(`${harness.origin}/api/library-context`)).json())
    expect(context.studies).toHaveLength(2)
    const expected = context.studies.map((study) => study.id).sort()[0]
    if (!expected) throw new TypeError("Missing synthetic study")
    // When
    await page.getByRole("link", { name: "Read this book", exact: true }).click()
    // Then
    await expect(page.locator("article")).toContainText(
      "Duplicate source with multiple saved studies",
    )
    await expect(page.locator(".desk-foot .status")).toContainText(expected)
    if (evidence) await page.screenshot({ path: join(evidence, "duplicate-source-identity.png") })
    await page.reload()
    await expect(page.locator("article")).toContainText(
      "Duplicate source with multiple saved studies",
    )
    await expect(page.locator(".desk-foot .status")).toContainText(expected)
    await page.getByText("Import another book / retained import receipt", { exact: true }).click()
    await upload(page, "Duplicate source with multiple saved studies")
    await page.getByRole("link", { name: "Read this book", exact: true }).click()
    await expect(page.locator("#chapter-title")).toBeVisible()
    await expect(page.locator("article")).toContainText(
      "Duplicate source with multiple saved studies",
    )
  } finally {
    await harness.close()
  }
})
