import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { expect, type Page } from "@playwright/test"

export async function runSecondAngle(
  page: Page,
  context: { readonly origin: string; readonly runDir: string; readonly studyId: string },
) {
  const { origin, runDir, studyId } = context
  await page.getByRole("link", { name: "Study revisions /" }).click()
  await page.getByRole("button", { name: "Fork a second lens /" }).click()
  await expect(page.getByRole("heading", { name: "Forked study /" })).toBeVisible()
  await page.screenshot({ path: join(runDir, "second-lens.png"), fullPage: true })
  const forkId = new URL(page.url()).pathname.split("/").at(-1)
  if (!forkId || forkId === studyId) throw new TypeError("Missing independent study")
  await page.getByRole("link", { name: "Edit answers /" }).click()
  await page.getByLabel("Your own response").fill("Read for shared decisions instead of asking")
  await page.getByRole("button", { name: "Save custom response" }).click()
  await expect(page.getByRole("status")).toContainText("Answer saved")
  await page.goto(`${origin}/briefs/${forkId}`)
  await page
    .getByLabel("Original question (English)")
    .fill("How can listening support a shared decision?")
  await page
    .getByLabel("最初の問い（日本語）", { exact: true })
    .fill("聴くことは共同の判断をどう支えますか？")
  await page.getByLabel("Refined question (English)").fill("What changes when we decide together?")
  await page
    .getByLabel("練り直した問い（日本語）", { exact: true })
    .fill("共に判断すると何が変わりますか？")
  await page.getByLabel("Supporting question 1 (English)").fill("Whose view is missing?")
  await page.getByLabel("補助の問い 1（日本語）").fill("誰の視点が欠けていますか？")
  await page.getByLabel("Purpose / 読書の目的").fill("Explore shared decisions")
  await page.getByLabel("Personal context / 個人的な背景").fill("A second synthetic reading angle")
  await page.getByRole("button", { name: "Review brief / 内容を確認" }).click()
  await page.getByRole("button", { name: "Approve brief" }).click()
  await page.getByRole("link", { name: "Study outline" }).click()
  await page.getByRole("button", { name: "Generate fixture outline" }).click()
  const forkOutlineId = await page
    .locator("[data-outline-revision]")
    .getAttribute("data-outline-revision")
  if (!forkOutlineId) throw new TypeError("Missing fork outline revision")
  await page.getByRole("button", { name: "Approve outline" }).click()
  await expect(async () => {
    await page.goto(`${origin}/evidence/${forkId}/synthetic-lesson-${forkOutlineId}`)
    await expect(page.getByRole("heading", { name: "Evidence and privacy" })).toBeVisible()
  }).toPass({ timeout: 30_000 })
  for (const category of ["support", "qualification", "translation", "visual"]) {
    await page.getByRole("button", { name: `Mark ${category} reviewed` }).click()
  }
  await page.getByRole("button", { name: "Confirm privacy review" }).click()
  await page.goto(`${origin}/publications/${forkId}`)
  await page.getByRole("button", { name: "Publish /" }).click()
  await page.getByRole("button", { name: "Generate approved files" }).click()
  await expect(async () => {
    await page.reload()
    await expect(page.getByRole("link", { name: "Download HTML" })).toBeVisible()
    await expect(page.getByRole("link", { name: "Download PDF" })).toBeVisible()
  }).toPass({ timeout: 30_000 })
  const secondLink = page.getByRole("link", { name: "Download HTML" })
  const secondHref = await secondLink.getAttribute("href")
  if (!secondHref?.startsWith("/publication-artifacts/"))
    throw new TypeError("Missing second publication download")
  const pending = page.waitForEvent("download")
  await secondLink.click()
  const secondDownload = await pending
  await secondDownload.saveAs(join(runDir, "study-second.html"))
  const first = await readFile(join(runDir, "study.html"), "utf8")
  const second = await readFile(join(runDir, "study-second.html"), "utf8")
  expect(first).toContain("How can asking change listening?")
  expect(second).toContain("How can listening support a shared decision?")
  expect(second).not.toContain("How can asking change listening?")
  expect(createHash("sha256").update(first).digest("hex")).not.toBe(
    createHash("sha256").update(second).digest("hex"),
  )
  await page.screenshot({ path: join(runDir, "second-publication.png"), fullPage: true })
  const secondArtifact = {
    format: "html" as const,
    path: join(runDir, "study-second.html"),
    sha256: createHash("sha256").update(second).digest("hex"),
    bytes: Buffer.byteLength(second),
    jobId: secondHref.slice("/publication-artifacts/".length),
    suggestedFilename: secondDownload.suggestedFilename(),
  }
  const secondPdfLink = page.getByRole("link", { name: "Download PDF" })
  const secondPdfHref = await secondPdfLink.getAttribute("href")
  if (!secondPdfHref?.startsWith("/publication-artifacts/"))
    throw new TypeError("Missing second PDF download")
  const secondPdfPending = page.waitForEvent("download")
  await secondPdfLink.click()
  const secondPdfDownload = await secondPdfPending
  const secondPdfPath = join(runDir, "study-second.pdf")
  await secondPdfDownload.saveAs(secondPdfPath)
  const secondPdfBytes = await readFile(secondPdfPath)
  expect(secondPdfBytes.length).toBeGreaterThan(100)
  return {
    forkId,
    forkOutlineId,
    downloads: [
      secondArtifact,
      {
        format: "pdf" as const,
        path: secondPdfPath,
        sha256: createHash("sha256").update(secondPdfBytes).digest("hex"),
        bytes: secondPdfBytes.length,
        jobId: secondPdfHref.slice("/publication-artifacts/".length),
        suggestedFilename: secondPdfDownload.suggestedFilename(),
      },
    ],
  }
}
