import { join } from "node:path"
import { expect, test } from "@playwright/test"
import { uploadHarness } from "@reading-studio/server/upload-fixture"

const evidence = process.env["TEN22_EVIDENCE_DIR"]
test("TEN-22 busy and queued states stay honest and existing sources stay usable", async ({
  page,
}) => {
  // Given
  const harness = await uploadHarness({ studioAssets: true })
  try {
    await page.goto(`${harness.origin}/imports?lang=en`)
    await page.locator("#epub-file").setInputFiles({
      name: "synthetic.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("A retained readable synthetic source"),
    })
    await page.getByRole("button", { name: "Import document", exact: true }).click()
    await expect(page.getByRole("link", { name: "Read this book", exact: true })).toBeVisible()
    let release: () => void = () => undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route("**/api/imports/upload", async (route) => {
      await held
      await route.fulfill({ status: 202, json: { id: "TEN22-queued", bytes: 10, state: "queued" } })
    })
    await page.locator("#epub-file").setInputFiles({
      name: "pending.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Not normalized"),
    })
    // When
    await page.getByRole("button", { name: "Import document", exact: true }).click()
    // Then
    await expect(page.getByRole("button", { name: "Importing…", exact: true })).toBeDisabled()
    await expect(page.locator("#epub-file")).toBeDisabled()
    if (evidence) await page.screenshot({ path: join(evidence, "busy.png") })
    release()
    await expect(page.locator(".intake-outcome-accepted[role=status]")).toContainText(
      "Not yet readable",
    )
    await expect(page.getByRole("link", { name: "Read this book", exact: true })).toHaveCount(0)
    const existing = page.getByRole("link", { name: "Imported TXT", exact: true })
    await expect(existing).toBeVisible()
    await page.locator(".intake-outcome-accepted").scrollIntoViewIfNeeded()
    if (evidence) await page.screenshot({ path: join(evidence, "queued.png") })
    await existing.click()
    await expect(page.locator("article")).toContainText("A retained readable synthetic source")
  } finally {
    await harness.close()
  }
})
