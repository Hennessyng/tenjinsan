import { execFileSync } from "node:child_process"
import { chromium, expect as visible } from "@playwright/test"
import { epubEntries, zipFixture } from "@reading-studio/ingestion/test-support"
import { expect, it } from "vitest"
import { z } from "zod"
import { InterviewState } from "../../apps/studio/src/interview/client.ts"
import { LibraryContext } from "../../apps/studio/src/library/client.ts"
import { startLocalMatrix } from "../deployment/matrix-local.ts"
import { syntheticEpub } from "../e2e/synthetic-epub.ts"

it("TEN-16 S4 T6 retains Stay edits and discards only unsaved room and study edits", async () => {
  execFileSync("bun", ["run", "--cwd", "apps/studio", "build"], { stdio: "pipe" })
  const browser = await chromium.launch()
  const inherited = process.env["VITEST"]
  delete process.env["VITEST"]
  const running = await startLocalMatrix(browser).finally(() => {
    if (inherited !== undefined) process.env["VITEST"] = inherited
  })
  try {
    const { page, origin } = running.deployment
    const post = (path: string, data: object) =>
      page.request.post(`${origin}${path}`, { data, headers: { origin } })
    await page.goto(`${origin}/login`)
    await page.getByLabel("Email").fill("owner@example.test")
    await page.getByLabel("Password").fill("correct horse battery staple")
    await page.getByRole("button", { name: "Log in", exact: true }).click()
    await page.waitForURL(`${origin}/`)
    await page.getByRole("status", { name: "Entering the library" }).waitFor({ state: "detached" })
    for (const bytes of [await syntheticEpub(), zipFixture(epubEntries)]) {
      expect(
        (
          await page.request.post(`${origin}/api/imports/upload`, {
            data: bytes,
            headers: { origin, "content-type": "application/epub+zip" },
          })
        ).status(),
      ).toBe(202)
    }
    const context = async () =>
      LibraryContext.parse(await (await page.request.get(`${origin}/api/library-context`)).json())
    await expect.poll(async () => (await context()).studies.length, { timeout: 60_000 }).toBe(2)
    const [study, other] = (await context()).studies
    if (!study?.normalizationId || !other)
      throw new TypeError("Two persisted owned synthetic studies missing")
    const setupResponse = await post(`/api/study-setup/${study.normalizationId}`, {
      provider: "openrouter",
      model: "gpt-4.1-mini",
      scope: "all-main-chapters",
    })
    expect(setupResponse.status()).toBe(201)
    const setupId = z.object({ setupId: z.string() }).parse(await setupResponse.json()).setupId
    expect(
      (
        await post(`/api/study-setup/${study.normalizationId}/${setupId}`, { decision: "send" })
      ).status(),
    ).toBe(200)
    expect((await post("/api/library-selection", { studyId: study.id })).status()).toBe(200)
    await expect
      .poll(async () => (await page.request.get(`${origin}/api/interviews/${study.id}`)).status(), {
        timeout: 60_000,
      })
      .toBe(200)
    await page.reload()
    const open = (name: string) =>
      page
        .getByRole("navigation", { name: "Reading route / 読書ルート" })
        .getByRole("button", { name: new RegExp(name) })
        .click()
    await open("Reference desk")
    await page.getByLabel("Notice", { exact: true }).check()
    await page.getByRole("button", { name: "Save choices", exact: true }).click()
    await visible(page.getByRole("status").filter({ hasText: /saved/i })).toBeVisible()
    const answers = async () =>
      InterviewState.parse(
        await (await page.request.get(`${origin}/api/interviews/${study.id}`)).json(),
      ).answers
    const saved = await answers()
    expect(saved).toHaveLength(1)
    const originalUrl = page.url()
    const draft = page.getByLabel("Your own response", { exact: true })
    await draft.fill("Unsaved synthetic garden conversation")
    const writes: string[] = []
    page.on("request", (request) => {
      if (request.method() !== "GET") writes.push(new URL(request.url()).pathname)
    })
    await open("Reading table")
    const dialog = page.getByRole("dialog", { name: /Unsaved changes/ })
    await visible(dialog).toBeVisible()
    await dialog.getByRole("button", { name: /Stay/ }).click()
    expect(page.url()).toBe(originalUrl)
    await visible(draft).toHaveValue("Unsaved synthetic garden conversation")
    expect(await answers()).toEqual(saved)
    expect(writes).toEqual([])
    const selection = page.getByLabel("Selected study / 選択した読書")
    await selection.selectOption(other.id)
    await page.getByRole("button", { name: "Select study / 読書を選ぶ", exact: true }).click()
    await visible(dialog).toBeVisible()
    await dialog.getByRole("button", { name: /Stay/ }).click()
    expect((await context()).selectedStudyId).toBe(study.id)
    await visible(draft).toHaveValue("Unsaved synthetic garden conversation")
    expect(writes).toEqual([])
    await open("Reading table")
    await visible(dialog).toBeVisible()
    await dialog.getByRole("button", { name: /Leave and discard/ }).click()
    await visible(page.getByLabel("Original question (English)")).toBeVisible()
    expect(await answers()).toEqual(saved)
    expect(writes).toEqual([])
    await open("Reference desk")
    await visible(draft).toHaveValue("")
    await visible(page.getByLabel("Notice", { exact: true })).toBeChecked()
    await draft.fill("Another unsaved synthetic draft")
    await page.goBack()
    await visible(dialog).toBeVisible()
    await dialog.getByRole("button", { name: /Stay/ }).click()
    await visible(draft).toHaveValue("Another unsaved synthetic draft")
    expect(new URL(page.url()).pathname).toBe(`/interviews/${study.id}`)
    await open("Reading table")
    await dialog.getByRole("button", { name: /Leave and discard/ }).click()
    const brief = page.getByLabel("Original question (English)")
    await brief.fill("Unsaved brief direction")
    await page.getByRole("button", { name: "Return to hall / 広間に戻る", exact: true }).click()
    await dialog.getByRole("button", { name: /Stay/ }).click()
    await visible(brief).toHaveValue("Unsaved brief direction")
    await page.getByRole("button", { name: "Return to hall / 広間に戻る", exact: true }).click()
    await dialog.getByRole("button", { name: /Leave and discard/ }).click()
    await open("Reading table")
    await visible(brief).toHaveValue("")
    expect(await answers()).toEqual(saved)
    expect(writes).toEqual([])
  } finally {
    await running.stop()
    await browser.close()
  }
}, 300_000)
