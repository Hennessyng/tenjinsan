import { execFileSync } from "node:child_process"
import { EventEmitter, once } from "node:events"
import { chromium, expect as visible } from "@playwright/test"
import { expect, it } from "vitest"
import { z } from "zod"
import { LibraryContext } from "../../apps/studio/src/library/client.ts"
import { startLocalMatrix } from "../deployment/matrix-local.ts"
import { syntheticEpub } from "../e2e/synthetic-epub.ts"

it.each(["loaded-null", "persisted-A"] as const)(
  "TEN-16 S1 F10 retains pending B through an unchanged real %s read until one owner selection",
  async (initial) => {
    execFileSync("bun", ["run", "--cwd", "apps/studio", "build"], { stdio: "pipe" })
    const browser = await chromium.launch()
    const inherited = process.env["VITEST"]
    delete process.env["VITEST"]
    const running = await startLocalMatrix(browser).finally(() => {
      if (inherited !== undefined) process.env["VITEST"] = inherited
    })
    const { page, origin } = running.deployment
    const continuation = new EventEmitter()
    try {
      await page.goto(`${origin}/login`)
      await page.getByLabel("Email").fill("owner@example.test")
      await page.getByLabel("Password").fill("correct horse battery staple")
      await page.getByRole("button", { name: "Log in", exact: true }).click()
      await page.waitForURL(`${origin}/`)
      await page
        .getByRole("status", { name: "Entering the library" })
        .waitFor({ state: "detached" })
      expect(
        (
          await page.request.post(`${origin}/api/imports/upload`, {
            data: await syntheticEpub(),
            headers: { origin, "content-type": "application/epub+zip" },
          })
        ).status(),
      ).toBe(202)
      const context = async () =>
        LibraryContext.parse(await (await page.request.get(`${origin}/api/library-context`)).json())
      await expect.poll(async () => (await context()).studies.length).toBe(1)
      const original = (await context()).studies[0]
      if (!original?.normalizationId) throw new TypeError("Owned normalized study missing")
      expect(
        (
          await page.request.post(`${origin}/api/study-setup/${original.normalizationId}`, {
            data: { provider: "openrouter", model: "gpt-4.1-mini" },
            headers: { origin },
          })
        ).status(),
      ).toBe(201)
      const revision = z
        .object({ view: z.object({ setup: z.object({ id: z.string() }) }) })
        .parse(await (await page.request.get(`${origin}/api/revision-page/${original.id}`)).json())
      const forkResponse = await page.request.post(`${origin}/api/revision-page/${original.id}`, {
        data: { action: "fork", expectedSetupRevisionId: revision.view.setup.id },
        headers: { origin },
      })
      expect(forkResponse.status()).toBe(200)
      const chosen = z
        .object({ forkStudyId: z.string() })
        .parse(await forkResponse.json()).forkStudyId
      if (initial === "persisted-A") {
        expect(
          (
            await page.request.post(`${origin}/api/library-selection`, {
              data: { studyId: original.id },
              headers: { origin },
            })
          ).status(),
        ).toBe(200)
      }
      await page.reload()
      await page
        .getByRole("status", { name: "Entering the library" })
        .waitFor({ state: "detached" })
      const selector = page.getByLabel("Selected study / 選択した読書")
      await visible(selector.locator("option")).toHaveCount(3)
      await visible(selector).toHaveValue(initial === "persisted-A" ? original.id : "")
      const route = page.getByRole("navigation", { name: "Reading route / 読書ルート" })
      const accessionRead = page.waitForResponse((reply) =>
        reply.url().endsWith("/api/library-context"),
      )
      await route.getByRole("button", { name: /Import & read/ }).click()
      await accessionRead
      await page.getByLabel("Choose EPUB").waitFor()
      const received = once(continuation, "received", { signal: AbortSignal.timeout(15000) })
      let held = false
      await page.route("**/api/library-context", async (request) => {
        if (!held) {
          held = true
          const release = once(continuation, "release")
          continuation.emit("received")
          await release
        }
        await request.continue()
      })
      const writes: string[] = []
      const selections: string[] = []
      page.on("request", (request) => {
        if (request.method() !== "GET") writes.push(new URL(request.url()).pathname)
        if (request.method() === "POST" && request.url().endsWith("/api/library-selection"))
          selections.push(z.object({ studyId: z.string() }).parse(request.postDataJSON()).studyId)
      })
      await page.getByRole("button", { name: "Return to hall / 広間に戻る", exact: true }).click()
      await received
      await selector.selectOption(chosen)
      await selector.focus()
      const button = page.getByRole("button", { name: "Select study / 読書を選ぶ", exact: true })
      await visible(button).toBeEnabled()
      const read = page.waitForResponse((reply) => reply.url().endsWith("/api/library-context"))
      continuation.emit("release")
      const unchanged = LibraryContext.parse(await (await read).json())
      expect(unchanged.selectedStudyId).toBe(initial === "persisted-A" ? original.id : null)
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          }),
      )
      await visible(selector).toHaveValue(chosen)
      await visible(selector).toBeFocused()
      await visible(button).toBeEnabled()
      expect(writes).toEqual([])
      const selected = page.waitForResponse((reply) =>
        reply.url().endsWith("/api/library-selection"),
      )
      await button.click()
      expect((await selected).status()).toBe(200)
      await expect.poll(async () => (await context()).selectedStudyId).toBe(chosen)
      expect(selections).toEqual([chosen])
      expect(writes).toEqual(["/api/library-selection"])
      await page.reload()
      await page
        .getByRole("status", { name: "Entering the library" })
        .waitFor({ state: "detached" })
      await visible(selector).toHaveValue(chosen)
    } finally {
      continuation.emit("release")
      await page.unrouteAll({ behavior: "wait" })
      await running.stop()
      await browser.close()
    }
  },
  300_000,
)
