import { execFileSync } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { chromium, expect as visible } from "@playwright/test"
import { expect, it } from "vitest"
import { z } from "zod"
import { LibraryContext } from "../../apps/studio/src/library/client.ts"
import { Library } from "../../apps/studio/src/source-viewer/client.ts"
import { startComposeMatrix, startLocalMatrix } from "../deployment/matrix-deployments.ts"
import { syntheticEpub } from "../e2e/synthetic-epub.ts"

it("TEN-16 S1 T3 downloads approved bilingual output through continuous ordinary rooms", async () => {
  execFileSync("bun", ["run", "--cwd", "apps/studio", "build"], { stdio: "pipe" })
  const browser = await chromium.launch({ args: ["--proxy-bypass-list=<-loopback>"] })
  const evidence = join(
    ".sisyphus/runs/ten-16-bring-the-mockup-library-journey-into-tenjinsan/evidence",
    `T3-journey-${randomUUID()}`,
  )
  await mkdir(evidence, { recursive: true })
  try {
    for (const mode of ["local", "compose"] as const) {
      const inherited = process.env["VITEST"]
      delete process.env["VITEST"]
      const running = await (mode === "local"
        ? startLocalMatrix(browser)
        : startComposeMatrix(browser)
      ).finally(() => {
        if (inherited !== undefined) process.env["VITEST"] = inherited
      })
      const { page, origin } = running.deployment
      const transitions: string[] = []
      const open = async (name: string) => {
        await page
          .getByRole("navigation", { name: "Reading route / 読書ルート" })
          .getByRole("button", { name: new RegExp(name) })
          .click()
        await visible(page.locator("#desk-title")).toBeVisible()
        transitions.push(new URL(page.url()).pathname)
      }
      const read = async (path: string) => {
        const response = await page.request.get(`${origin}${path}`)
        expect(response.status()).toBe(200)
        return response.json()
      }
      let htmlPath = ""
      try {
        await page.goto(`${origin}/login`)
        await page.getByLabel("Email").fill("owner@example.test")
        await page.getByLabel("Password").fill("correct horse battery staple")
        await page.getByRole("button", { name: "Log in", exact: true }).click()
        await page.waitForURL(`${origin}/`)
        await page
          .getByRole("status", { name: "Entering the library" })
          .waitFor({ state: "detached" })
        await open("Import & read")
        await page.getByLabel("Choose EPUB").setInputFiles({
          name: "synthetic.epub",
          mimeType: "application/epub+zip",
          buffer: await syntheticEpub(),
        })
        await page.getByRole("button", { name: "Import EPUB", exact: true }).click()
        await visible(page.getByRole("heading", { name: "Import accepted" })).toBeVisible()
        await expect
          .poll(async () => Library.parse(await read("/api/source-library")).documents.length, {
            timeout: 60_000,
          })
          .toBe(1)
        const source = Library.parse(await read("/api/source-library")).documents[0]
        if (!source) throw new TypeError("Normalized synthetic source missing")
        await page.getByRole("button", { name: "Return to hall / 広間に戻る", exact: true }).click()
        const context = LibraryContext.parse(await read("/api/library-context"))
        const study = context.studies.find((item) => item.editionId === source.edition.id)
        if (!study) throw new TypeError("Persisted synthetic study missing")
        expect(study.title).toBe(source.edition.title)
        const selection = page.getByLabel("Selected study / 選択した読書")
        await visible(
          selection.getByRole("option", {
            name: `${source.edition.title} · ${study.id}`,
            exact: true,
          }),
        ).toHaveAttribute("value", study.id)
        await selection.selectOption(study.id)
        await page.getByRole("button", { name: "Select study / 読書を選ぶ", exact: true }).click()
        await expect
          .poll(
            async () => LibraryContext.parse(await read("/api/library-context")).selectedStudyId,
          )
          .toBe(study.id)
        await open("Import & read")
        await page.locator(`a[href="/sources/${source.normalization.id}"]`).click()
        await visible(
          page.getByRole("heading", { name: source.edition.title, exact: true }),
        ).toBeVisible()
        await visible(page.getByRole("navigation", { name: "Workspace rooms" })).toHaveCount(0)
        await visible(page.getByRole("link", { name: "READING STUDIO", exact: true })).toHaveCount(
          0,
        )
        await open("Lending desk")
        await page.getByRole("button", { name: "Review transmission", exact: true }).click()
        await page.getByRole("button", { name: "Send", exact: true }).click()
        await visible(page.getByRole("heading", { name: "Transmission approved" })).toBeVisible()
        await expect
          .poll(
            async () => (await page.request.get(`${origin}/api/interviews/${study.id}`)).status(),
            { timeout: 60_000 },
          )
          .toBe(200)
        await open("Reference desk")
        await page.getByLabel("Notice", { exact: true }).check()
        await page.getByRole("button", { name: "Save choices", exact: true }).click()
        await visible(page.getByRole("status").filter({ hasText: /saved/i })).toBeVisible()
        await open("Reading table")
        await page
          .getByLabel("Original question (English)")
          .fill("How does attention shape listening?")
        await page
          .getByLabel("最初の問い（日本語）", { exact: true })
          .fill("注意は聴くことをどう変えますか？")
        await page.getByLabel("Purpose / 読書の目的").fill("Read the synthetic source carefully")
        await page.getByLabel("Personal context / 個人的な背景").fill("Synthetic QA context")
        await page.getByRole("button", { name: "Review brief / 内容を確認" }).click()
        await page.getByRole("button", { name: "Approve brief", exact: false }).click()
        await visible(page.getByRole("status").filter({ hasText: "Brief approved" })).toBeVisible()
        await open("Card catalogue")
        await page.getByRole("button", { name: "Queue outline generation", exact: true }).click()
        await expect
          .poll(
            async () => {
              const data = z
                .object({ view: z.object({ draft: z.object({ id: z.string() }) }).nullable() })
                .parse(await read(`/api/outlines/${study.id}`))
              return data.view?.draft.id ?? null
            },
            { timeout: 60_000 },
          )
          .not.toBeNull()
        await open("Bindery")
        await visible(page.getByRole("heading", { name: /Study progress/ })).toBeVisible()
        await open("Card catalogue")
        await page.getByRole("button", { name: /Approve outline/ }).click()
        await visible(
          page.getByRole("status").filter({ hasText: "Outline approved" }),
        ).toBeVisible()
        await expect
          .poll(
            async () => (await page.request.get(`${origin}/api/evidence/${study.id}`)).status(),
            { timeout: 60_000 },
          )
          .toBe(200)
        await open("Review room")
        await visible(page.getByRole("heading", { name: /Evidence and privacy/ })).toBeVisible()
        for (const category of ["support", "qualification", "translation", "visual"]) {
          await page.getByRole("button", { name: `Mark ${category} reviewed`, exact: true }).click()
        }
        await page.getByRole("button", { name: /Confirm privacy review/ }).click()
        await visible(
          page.getByRole("status").filter({ hasText: "Ready for later publication approval" }),
        ).toBeVisible()
        await open("Revision ledger")
        expect((await page.request.get(`${origin}/api/revision-page/${study.id}`)).status()).toBe(
          200,
        )
        await visible(page.getByRole("heading", { name: /Study revisions/ })).toBeVisible()
        await open("Display case")
        await visible(page.getByRole("heading", { name: /Cleaned publication/ })).toBeVisible()
        await visible(page.locator("#reading")).toContainText("How does attention shape listening?")
        await visible(page.locator("#reading")).toContainText("注意は聴くことをどう変えますか？")
        await page.getByRole("button", { name: /Publish \/ / }).click()
        await page.getByRole("button", { name: /Generate approved files/ }).click()
        await expect
          .poll(
            async () => {
              const data = z
                .object({
                  history: z.array(z.object({ outputs: z.array(z.object({ state: z.string() })) })),
                })
                .parse(await read(`/api/publications/${study.id}`))
              return (
                data.history[0]?.outputs.filter((item) => item.state === "released").length ?? 0
              )
            },
            { timeout: 90_000 },
          )
          .toBe(2)
        await open("Revision ledger")
        await open("Display case")
        const downloads: { format: string; sha256: string; bytes: number }[] = []
        for (const format of ["HTML", "PDF"]) {
          const link = page.getByRole("link", { name: `Download ${format}`, exact: false })
          const href = await link.getAttribute("href")
          if (!href?.startsWith("/publication-artifacts/"))
            throw new TypeError("Released artifact link missing")
          expect(
            (await page.request.get(`${origin}${href}`, { headers: { cookie: "" } })).status(),
          ).toBe(401)
          const pending = page.waitForEvent("download")
          await link.click()
          const download = await pending
          const path = join(evidence, `${mode}.${format.toLowerCase()}`)
          await download.saveAs(path)
          const bytes = await readFile(path)
          const sha256 = createHash("sha256").update(bytes).digest("hex")
          downloads.push({ format, sha256, bytes: bytes.length })
          if (format === "HTML") htmlPath = path
          else {
            const text = execFileSync("pdftotext", [path, "-"], { encoding: "utf8" })
            expect(text).toContain("How does attention shape listening?")
            expect(text).toContain("注意は聴くことをどう変えますか？")
          }
        }
        for (const viewport of [
          { width: 390, height: 844 },
          { width: 768, height: 1024 },
          { width: 1280, height: 800 },
        ]) {
          await page.setViewportSize(viewport)
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          ).toBe(true)
          await page.screenshot({
            path: join(evidence, `${mode}-display-${viewport.width}.png`),
            fullPage: true,
          })
        }
        const receipt = { mode, studyId: study.id, title: study.title, transitions, downloads }
        await writeFile(join(evidence, `${mode}.json`), JSON.stringify(receipt))
      } finally {
        await running.stop()
      }
      const offline = await browser.newContext({ offline: true })
      try {
        const external: string[] = []
        await offline.route(/https?:\/\//, (route) => {
          external.push(route.request().url())
          return route.abort()
        })
        const page = await offline.newPage()
        await page.goto(pathToFileURL(join(process.cwd(), htmlPath)).href)
        await visible(page.locator("main")).toContainText("How does attention shape listening?")
        await visible(page.locator("main")).toContainText("注意は聴くことをどう変えますか？")
        expect(external).toEqual([])
        await page.screenshot({ path: join(evidence, `${mode}-offline.png`), fullPage: true })
      } finally {
        await offline.close()
      }
    }
  } finally {
    await browser.close()
  }
}, 1_800_000)
