import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { promisify } from "node:util"
import { expect, test } from "@playwright/test"
import { publicationFixture } from "@reading-studio/server/publication-fixture"
import { sourceViewerFixture } from "@reading-studio/server/source-viewer-fixture"

const exec = promisify(execFile)
const evidence = ".omo/evidence/reading-studio/task-31"

test("Given a synthetic approved lesson, when the owner publishes and revises, then downloads remain independently readable", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000)
  const fixture = await publicationFixture()
  const directory = join(evidence, "screenshots")
  await mkdir(directory, { recursive: true })
  const artifacts: { format: string; sha256: string; bytes: number }[] = []
  try {
    // Given: a real SQLite-backed owner, source, approved outline, lesson and reviewed projection.
    await page.goto(`${fixture.origin}/login`)
    await page.getByLabel("Email").fill(fixture.credentials.email)
    await page.getByLabel("Password").fill(fixture.credentials.password)
    await page.getByRole("button", { name: "Log in" }).click()
    await page.goto(`${fixture.origin}${fixture.path}`)
    await expect(page.getByRole("button", { name: "Publish /" })).toBeEnabled()
    await page.screenshot({ path: join(directory, "01-reviewed.png"), fullPage: true })

    // When: the owner approves and requests actual generated artifacts.
    await page.getByRole("button", { name: "Publish /" }).click()
    await page.getByRole("button", { name: "Generate approved files" }).click()
    await expect(page.getByRole("link", { name: "Download PDF" })).toBeVisible()
    await page.screenshot({ path: join(directory, "02-published.png"), fullPage: true })
    for (const format of ["HTML", "PDF"]) {
      const pending = page.waitForEvent("download")
      await page.getByRole("link", { name: `Download ${format}` }).click()
      const download = await pending
      const target = join(evidence, `lesson.${format.toLowerCase()}`)
      await download.saveAs(target)
      const bytes = await readFile(target)
      expect(bytes.byteLength).toBeGreaterThan(100)
      expect(bytes.toString("latin1", 0, 16)).toContain(format === "PDF" ? "%PDF-" : "<!doctype")
      expect(bytes.toString()).not.toContain("Mira Canarystone")
      artifacts.push({
        format,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        bytes: bytes.length,
      })
    }

    // Then: a standalone file opens with network blocked and contains real teaching text.
    const offline = await browser.newContext({ offline: true })
    try {
      const requests: string[] = []
      await offline.route(/https?:\/\//, (route) => {
        requests.push(route.request().url())
        return route.abort()
      })
      const lesson = await offline.newPage()
      await lesson.goto(pathToFileURL(join(process.cwd(), evidence, "lesson.html")).href)
      await expect(lesson.locator("main")).toContainText("Ask a colleague")
      await lesson.screenshot({ path: join(directory, "03-offline.png"), fullPage: true })
      expect(requests).toEqual([])
    } finally {
      await offline.close()
    }
    const { stdout: pdfText } = await exec("pdftotext", [join(evidence, "lesson.pdf"), "-"])
    expect(pdfText).toContain("Ask a colleague")
    expect(pdfText).not.toContain("Mira Canarystone")
    await writeFile(join(evidence, "lesson-pdf.txt"), pdfText)

    await page.getByRole("link", { name: "Study revisions /" }).click()
    await page.getByRole("button", { name: "Fork a second lens /" }).click()
    await expect(page.getByRole("heading", { name: "Forked study /" })).toBeVisible()
    const forkId = new URL(page.url()).pathname.split("/").at(-1)
    expect(forkId).not.toBe(fixture.lesson.studyId)
    await page.screenshot({ path: join(directory, "04-forked.png"), fullPage: true })
    await page.getByRole("link", { name: "Edit answers /" }).click()
    await page.getByLabel("Your own response").fill("A different angle on listening")
    await page.getByRole("button", { name: "Save custom response" }).click()
    expect(fixture.storage.counts().publications).toBe(1)
    await writeFile(join(evidence, "artifacts.json"), JSON.stringify(artifacts, null, 2))
  } finally {
    await fixture.close()
  }
})

test("Given an owner session, when a corrupt EPUB is uploaded and the session is lost, then no source leaks", async ({
  page,
}) => {
  const fixture = await sourceViewerFixture()
  try {
    // Given
    await page.goto(`${fixture.origin}/login`)
    await page.getByLabel("Email").fill(fixture.credentials.email)
    await page.getByLabel("Password").fill(fixture.credentials.password)
    await page.getByRole("button", { name: "Log in" }).click()
    // When
    const corrupt = await page.request.post(`${fixture.origin}/api/imports/upload`, {
      headers: {
        origin: fixture.origin,
        "content-type": "application/epub+zip",
        "content-disposition": 'attachment; filename="broken.epub"',
      },
      data: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]),
    })
    // Then
    expect(corrupt.status()).toBe(422)
    await page.context().clearCookies()
    const source = await page.goto(`${fixture.origin}/sources/revision-fixture`)
    expect(source?.status()).toBe(401)
    await expect(page.getByText("A good question opens a door.")).toHaveCount(0)
    await mkdir(`${evidence}/screenshots`, { recursive: true })
    await page.screenshot({ path: `${evidence}/screenshots/05-session-expired.png` })
  } finally {
    await fixture.close()
  }
})

test("Given a downloaded publication, when its server stops, then the HTML remains readable offline", async ({
  page,
  browser,
}) => {
  const fixture = await publicationFixture()
  const target = join(process.cwd(), evidence, "server-stopped.html")
  try {
    // Given
    await page.goto(`${fixture.origin}/login`)
    await page.getByLabel("Email").fill(fixture.credentials.email)
    await page.getByLabel("Password").fill(fixture.credentials.password)
    await page.getByRole("button", { name: "Log in" }).click()
    await page.goto(`${fixture.origin}${fixture.path}`)
    await page.getByRole("button", { name: "Publish /" }).click()
    await page.getByRole("button", { name: "Generate approved files" }).click()
    const pending = page.waitForEvent("download")
    await page.getByRole("link", { name: "Download HTML" }).click()
    await (await pending).saveAs(target)
  } finally {
    await fixture.close()
  }

  // When
  const offline = await browser.newContext({ offline: true })
  try {
    const requests: string[] = []
    await offline.route(/https?:\/\//, (route) => {
      requests.push(route.request().url())
      return route.abort()
    })
    const document = await offline.newPage()
    await document.goto(pathToFileURL(target).href)
    // Then
    await expect(document.locator("main")).toContainText("Ask a colleague")
    expect(requests).toEqual([])
    await document.screenshot({
      path: `${evidence}/screenshots/06-server-stopped.png`,
      fullPage: true,
    })
  } finally {
    await offline.close()
  }
})
