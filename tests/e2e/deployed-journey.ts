import { execFile } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { promisify } from "node:util"
import { type Browser, expect, type Page } from "@playwright/test"
import { runSecondAngle } from "./deployed-second-angle.ts"
import { syntheticEpub } from "./synthetic-epub.ts"

const exec = promisify(execFile)

export async function runDeployedJourney(page: Page, origin: string, evidence: string) {
  const runId = randomUUID()
  const runDir = join(evidence, "runs", runId)
  await mkdir(runDir, { recursive: true })
  await page.goto(`${origin}/login`)
  await page.getByLabel("Email").fill("owner@example.test")
  await page.getByLabel("Password").fill("correct horse battery staple")
  await page.getByRole("button", { name: "Log in" }).click()
  await expect(page.locator("#root")).toBeVisible()
  await page.getByLabel("Choose EPUB").setInputFiles({
    name: "synthetic.epub",
    mimeType: "application/epub+zip",
    buffer: await syntheticEpub(),
  })
  await page.getByRole("button", { name: "Import EPUB" }).click()
  await expect(page.getByRole("status")).toContainText("Import accepted")
  await expect(async () => {
    await page.goto(`${origin}/sources`)
    await expect(page.getByRole("link", { name: "Synthetic attention journal" })).toBeVisible()
  }).toPass({ timeout: 10_000 })
  await page.getByRole("link", { name: "Synthetic attention journal" }).click()
  await page.getByRole("link", { name: "Set up a study" }).click()
  await page.getByRole("button", { name: "Review transmission" }).click()
  await page.getByRole("button", { name: "Send", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Transmission approved" })).toBeVisible()
  await expect(async () => {
    await page.goto(`${origin}/interviews`)
    await expect(page.getByRole("link", { name: /Where would you like to begin/ })).toBeVisible()
  }).toPass({ timeout: 10_000 })
  await page.getByRole("link", { name: /Where would you like to begin/ }).click()
  await page.getByLabel("Ask a more open question").check()
  await page.getByRole("button", { name: "Save choices" }).click()
  await page.getByRole("link", { name: "Next", exact: true }).click()
  await page.getByLabel("At work").check()
  await page.getByLabel("At home").check()
  await page.getByRole("button", { name: "Save choices" }).click()
  await page.getByLabel("Your own response").fill("Questions in a shared garden")
  await page.getByRole("button", { name: "Save custom response" }).click()
  await page.getByRole("button", { name: "Not sure yet" }).click()
  await page.getByLabel("Your own response").fill("Listen during a garden conversation")
  await page.getByRole("button", { name: "Save custom response" }).click()
  await page.getByRole("link", { name: "Next", exact: true }).click()
  await page.getByLabel("Approve these responses").check()
  await page.getByRole("button", { name: "Save choices" }).click()
  await page.getByRole("link", { name: /Reading brief/ }).click()
  await page.getByLabel("Original question (English)").fill("How can asking change listening?")
  await page
    .getByLabel("最初の問い（日本語）", { exact: true })
    .fill("問いかけは聴き方をどう変えますか？")
  await page.getByLabel("Refined question (English)").fill("What can I learn by asking first?")
  await page
    .getByLabel("練り直した問い（日本語）", { exact: true })
    .fill("まず尋ねると何が学べますか？")
  await page.getByLabel("Supporting question 1 (English)").fill("When should I pause?")
  await page.getByLabel("補助の問い 1（日本語）").fill("いつ立ち止まるべきですか？")
  await page.getByLabel("Purpose / 読書の目的").fill("Practice asking before interpreting")
  await page.getByLabel("Personal context / 個人的な背景").fill("Synthetic garden discussion")
  await page.getByRole("button", { name: "Review brief / 内容を確認" }).click()
  await page.getByRole("button", { name: "Approve brief" }).click()
  await page.getByRole("link", { name: "Study outline" }).click()
  await page.getByRole("button", { name: "Generate fixture outline" }).click()
  const outlineId = await page
    .locator("[data-outline-revision]")
    .getAttribute("data-outline-revision")
  if (!outlineId) throw new TypeError("Missing outline revision")
  await page.getByRole("button", { name: "Approve outline" }).click()
  await expect(page.getByRole("status")).toHaveText("Outline approved")
  await page.screenshot({ path: join(runDir, "outline.png"), fullPage: true })
  const studyId = new URL(page.url()).pathname.split("/").at(-1)
  if (!studyId) throw new TypeError("Missing study ID")
  const lessonId = `synthetic-lesson-${outlineId}`
  await expect(async () => {
    await page.goto(`${origin}/evidence/${studyId}/${lessonId}`)
    await expect(page.getByRole("heading", { name: "Evidence and privacy" })).toBeVisible()
  }).toPass({ timeout: 30_000 })
  await expect(page.getByRole("heading", { name: "Evidence and privacy" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Confirm privacy review" })).toBeEnabled()
  for (const category of ["support", "qualification", "translation", "visual"]) {
    await page.getByRole("button", { name: `Mark ${category} reviewed` }).click()
  }
  await page.getByRole("button", { name: "Confirm privacy review" }).click()
  await expect(page.getByRole("status")).toContainText("Ready for later publication approval")
  await page.screenshot({ path: join(runDir, "privacy.png"), fullPage: true })
  await page.getByRole("link", { name: "Preview cleaned projection" }).click()
  await expect(page.getByRole("heading").first()).toBeVisible()
  await page.screenshot({ path: join(runDir, "reader.png"), fullPage: true })
  await page.goto(`${origin}/publications/${studyId}`)
  await page.getByRole("button", { name: "Publish /" }).click()
  await page.getByRole("button", { name: "Generate approved files" }).click()
  await expect(async () => {
    await page.reload()
    await expect(page.getByRole("link", { name: "Download PDF" })).toBeVisible()
  }).toPass({ timeout: 30_000 })
  const downloads: {
    readonly format: "html" | "pdf"
    readonly path: string
    readonly sha256: string
    readonly bytes: number
    readonly jobId: string
    readonly suggestedFilename: string
  }[] = []
  for (const format of ["HTML", "PDF"]) {
    const link = page.getByRole("link", { name: `Download ${format}` })
    const href = await link.getAttribute("href")
    if (!href?.startsWith("/publication-artifacts/"))
      throw new TypeError("Missing owner-scoped publication download")
    const pending = page.waitForEvent("download")
    await link.click()
    const download = await pending
    const target = join(runDir, `study.${format.toLowerCase()}`)
    await download.saveAs(target)
    const bytes = await readFile(target)
    expect(bytes.length).toBeGreaterThan(100)
    downloads.push({
      format: format === "HTML" ? "html" : "pdf",
      path: target,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.length,
      jobId: href.slice("/publication-artifacts/".length),
      suggestedFilename: download.suggestedFilename(),
    })
  }
  const { stdout: pdfText } = await exec("pdftotext", [join(runDir, "study.pdf"), "-"])
  expect(pdfText).toContain("How can asking change listening?")
  await writeFile(join(runDir, "artifacts.json"), JSON.stringify(downloads, null, 2))
  await page.screenshot({ path: join(runDir, "publication.png"), fullPage: true })
  const second = await runSecondAngle(page, { origin, runDir, studyId })
  return {
    runId,
    runDir,
    manifestPath: join(runDir, "manifest.json"),
    studyId,
    outlineId,
    lessonId,
    forkId: second.forkId,
    forkOutlineId: second.forkOutlineId,
    downloads: [...downloads, ...second.downloads],
  }
}

export async function verifyDeployedOffline(browser: Browser, evidence: string): Promise<void> {
  const offline = await browser.newContext({ offline: true })
  try {
    const external: string[] = []
    await offline.route(/https?:\/\//, (route) => {
      external.push(route.request().url())
      return route.abort()
    })
    const document = await offline.newPage()
    await document.goto(pathToFileURL(join(process.cwd(), evidence, "study.html")).href)
    await expect(document.locator("main")).toContainText("How can asking change listening?")
    expect(external).toEqual([])
    await document.screenshot({ path: join(evidence, "offline-after-stop.png"), fullPage: true })
  } finally {
    await offline.close()
  }
}
