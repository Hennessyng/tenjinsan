import { execFileSync } from "node:child_process"
import { chromium, expect as visible } from "@playwright/test"
import { expect, it } from "vitest"
import { z } from "zod"
import { Library } from "../../apps/studio/src/source-viewer/client.ts"
import { startLocalMatrix } from "../deployment/matrix-local.ts"
import { syntheticEpub } from "../e2e/synthetic-epub.ts"

it("TEN-16 S1 T2 selects the owned imported study through all ten rooms", async () => {
  execFileSync("bun", ["run", "--cwd", "apps/studio", "build"], { stdio: "pipe" })
  const browser = await chromium.launch()
  const vitestEnvironment = process.env["VITEST"]
  delete process.env["VITEST"]
  const running = await startLocalMatrix(browser)
    .finally(() => {
      if (vitestEnvironment !== undefined) process.env["VITEST"] = vitestEnvironment
    })
    .catch(async (error: unknown) => {
      await browser.close()
      throw error
    })
  try {
    const { page, origin } = running.deployment
    await page.goto(`${origin}/login`)
    await page.getByLabel("Email").fill("owner@example.test")
    await page.getByLabel("Password").fill("correct horse battery staple")
    await page.getByRole("button", { name: "Log in", exact: true }).click()
    await page.waitForURL(`${origin}/`)
    await page.getByRole("status", { name: "Entering the library" }).waitFor({ state: "detached" })
    await page.goto(`${origin}/imports`)
    await page.getByLabel("Choose EPUB").setInputFiles({
      name: "synthetic.epub",
      mimeType: "application/epub+zip",
      buffer: await syntheticEpub(),
    })
    await page.getByRole("button", { name: "Import EPUB", exact: true }).click()
    await visible(page.getByRole("heading", { name: "Import accepted" })).toBeVisible()
    await expect
      .poll(
        async () => {
          const response = await page.request.get(`${origin}/api/source-library`)
          const data: { documents: readonly unknown[] } = await response.json()
          return data.documents.length
        },
        { timeout: 60_000 },
      )
      .toBeGreaterThan(0)
    const sourcesResponse = await page.request.get(`${origin}/api/source-library`)
    expect(sourcesResponse.status()).toBe(200)
    const sources = Library.parse(await sourcesResponse.json())
    expect(sources.documents).toHaveLength(1)
    const imported = sources.documents[0]
    if (!imported) throw new TypeError("Synthetic EPUB has no normalized source")
    const contextResponse = await page.request.get(`${origin}/api/library-context`)
    expect(contextResponse.status()).toBe(200)
    const context = z
      .object({
        studies: z.array(
          z.object({
            id: z.string(),
            editionId: z.string(),
            title: z.string(),
            normalizationId: z.string().nullable(),
          }),
        ),
      })
      .parse(await contextResponse.json())
    const owned = context.studies.filter((study) => study.editionId === imported.edition.id)
    expect(owned).toHaveLength(1)
    const sourceStudy = owned[0]
    if (!sourceStudy) throw new TypeError("Synthetic EPUB has no owned study")
    expect(sourceStudy.normalizationId).toBe(imported.normalization.id)
    expect(sourceStudy.title).toBe(imported.edition.title)
    const studyId = sourceStudy.id
    await page.goto(`${origin}/`)
    await visible(page.getByLabel("Selected study / 選択した読書")).toBeVisible()
    const selection = page.getByLabel("Selected study / 選択した読書")
    const option = selection.getByRole("option", {
      name: `${imported.edition.title} · ${studyId}`,
      exact: true,
    })
    await visible(option).toHaveAttribute("value", studyId)
    await visible(option).toHaveText(`${imported.edition.title} · ${studyId}`)
    await selection.selectOption(studyId)
    await page.getByRole("button", { name: "Select study / 読書を選ぶ", exact: true }).click()
    await expect
      .poll(async () => {
        const response = await page.request.get(`${origin}/api/library-context`)
        const data: { selectedStudyId: string | null } = await response.json()
        return data.selectedStudyId
      })
      .toBe(studyId)
    const rooms = [
      "Accession desk",
      "The stacks",
      "Lending desk",
      "Reference desk",
      "Reading table",
      "Card catalogue",
      "Bindery",
      "Review room",
      "Revision ledger",
      "Display case",
    ]
    for (const room of rooms) {
      await visible(
        page
          .getByRole("navigation", { name: "Reading route / 読書ルート" })
          .getByRole("button", { name: new RegExp(room) }),
      ).toHaveCount(1)
    }
    await page.reload()
    await visible(selection).toHaveValue(studyId)
    const writes: string[] = []
    page.on("request", (request) => {
      if (request.method() !== "GET") writes.push(new URL(request.url()).pathname)
    })
    await page
      .getByRole("navigation", { name: "Reading route / 読書ルート" })
      .getByRole("button", { name: /Display case/ })
      .click()
    await visible(page.getByRole("heading", { name: /Approve and download/ })).toBeVisible()
    await page.getByRole("button", { name: "Return to hall / 広間に戻る", exact: true }).click()
    await visible(selection).toHaveValue(studyId)
    expect(writes).toEqual([])
    const hostile = await page.request.post(`${origin}/api/library-selection`, {
      headers: { Origin: "https://attacker.invalid" },
      data: { studyId },
    })
    expect(hostile.status()).toBe(403)
    const foreign = await page.request.post(`${origin}/api/library-selection`, {
      headers: { Origin: origin },
      data: { studyId: "foreign-study" },
    })
    expect(foreign.status()).toBe(404)
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 1280, height: 800 },
    ]) {
      await page.setViewportSize(viewport)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
      await selection.focus()
      await visible(selection).toBeFocused()
    }
    await page.emulateMedia({ reducedMotion: "reduce" })
    await page.reload()
    await visible(selection).toHaveValue(studyId)
    expect(await running.deployment.wireCount()).toBe(0)
  } finally {
    await running.stop()
    await browser.close()
  }
}, 300_000)
