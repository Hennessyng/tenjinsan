import { execFileSync } from "node:child_process"
import { EventEmitter, once } from "node:events"
import { chromium, type Page, expect as visible } from "@playwright/test"
import { expect, it } from "vitest"
import { LibraryContext } from "../../apps/studio/src/library/client.ts"
import { startLocalMatrix } from "../deployment/matrix-deployments.ts"
import { syntheticEpub } from "../e2e/synthetic-epub.ts"

async function withOwnedInterview(verify: (page: Page, studyId: string) => Promise<void>) {
  execFileSync("bun", ["run", "--cwd", "apps/studio", "build"], { stdio: "pipe" })
  const browser = await chromium.launch()
  const inherited = process.env["VITEST"]
  delete process.env["VITEST"]
  const running = await startLocalMatrix(browser).finally(() => {
    if (inherited !== undefined) process.env["VITEST"] = inherited
  })
  const { page, origin } = running.deployment
  try {
    await page.goto(`${origin}/login`)
    await page.getByLabel("Email").fill("owner@example.test")
    await page.getByLabel("Password").fill("correct horse battery staple")
    await page.getByRole("button", { name: "Log in", exact: true }).click()
    await page.waitForURL(`${origin}/`)
    await page.getByRole("status", { name: "Entering the library" }).waitFor({ state: "detached" })
    const route = page.getByRole("navigation", { name: "Reading route / 読書ルート" })
    await route.getByRole("button", { name: /Import & read/ }).click()
    await page.getByLabel("Choose EPUB").setInputFiles({
      name: "synthetic.epub",
      mimeType: "application/epub+zip",
      buffer: await syntheticEpub(),
    })
    await page.getByRole("button", { name: "Import EPUB", exact: true }).click()
    await visible(page.getByRole("heading", { name: "Import accepted" })).toBeVisible()
    await expect
      .poll(
        async () =>
          (await (await page.request.get(`${origin}/api/source-library`)).json()).documents.length,
      )
      .toBe(1)
    await page.getByRole("button", { name: "Return to hall / 広間に戻る", exact: true }).click()
    const context = LibraryContext.parse(
      await (await page.request.get(`${origin}/api/library-context`)).json(),
    )
    const study = context.studies[0]
    if (!study) throw new TypeError("Owned normalized study missing")
    await page.getByLabel("Selected study / 選択した読書").selectOption(study.id)
    const selected = page.waitForResponse((response) =>
      response.url().endsWith("/api/library-selection"),
    )
    await page.getByRole("button", { name: "Select study / 読書を選ぶ", exact: true }).click()
    expect((await selected).status()).toBe(200)
    await expect
      .poll(
        async () =>
          LibraryContext.parse(
            await (await page.request.get(`${origin}/api/library-context`)).json(),
          ).selectedStudyId,
      )
      .toBe(study.id)
    await route.getByRole("button", { name: /Lending desk/ }).click()
    await page.getByRole("button", { name: "Review transmission", exact: true }).click()
    await page.getByRole("button", { name: "Send", exact: true }).click()
    await visible(page.getByRole("heading", { name: "Transmission approved" })).toBeVisible()
    await expect
      .poll(async () => (await page.request.get(`${origin}/api/interviews/${study.id}`)).status())
      .toBe(200)
    await page.getByRole("button", { name: "Return to hall / 広間に戻る", exact: true }).click()
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        }),
    )
    await verify(page, study.id)
  } finally {
    await running.stop()
    await browser.close()
  }
}

it("TEN-16 S1 F6 retains keyboard desk focus after actual interview controls settle", async () => {
  await withOwnedInterview(async (page) => {
    const control = page
      .getByRole("navigation", { name: "Reading route / 読書ルート" })
      .getByRole("button", { name: /Reference desk/ })
    await control.focus()
    await page.keyboard.press("Enter")
    await visible(page.getByLabel("Your own response")).toBeVisible()
    await visible(page.getByLabel("Notice", { exact: true })).toBeVisible()
    await visible(page.locator("#desk-title")).toBeFocused()
    await visible(page.getByRole("main")).toHaveCount(1)
  })
}, 300_000)

it("TEN-16 S1 F6 preserves user focus through real prerequisite completion and later reads", async () => {
  await withOwnedInterview(async (page, studyId) => {
    const continuation = new EventEmitter()
    const received = once(continuation, "received")
    let delayed = false
    await page.route(`**/api/interviews/${studyId}`, async (request) => {
      if (!delayed) {
        delayed = true
        const release = once(continuation, "release")
        continuation.emit("received")
        await release
      }
      await request.continue()
    })
    try {
      const control = page
        .getByRole("navigation", { name: "Reading route / 読書ルート" })
        .getByRole("button", { name: /Reference desk/ })
      await control.focus()
      await page.keyboard.press("Enter")
      await received
      await visible(page.getByRole("main")).toHaveCount(1)
      const selector = page.getByLabel("Selected study / 選択した読書")
      await selector.focus()
      await visible(selector).toBeFocused()
      continuation.emit("release")
      await visible(page.getByLabel("Your own response")).toBeVisible()
      await visible(selector).toBeFocused()
      await visible(page.getByRole("main")).toHaveCount(1)
      const input = page.getByLabel("Your own response")
      await input.focus()
      const origin = new URL(page.url()).origin
      expect((await page.request.get(`${origin}/api/interviews/${studyId}`)).status()).toBe(200)
      expect((await page.request.get(`${origin}/api/library-context`)).status()).toBe(200)
      await visible(input).toBeFocused()
    } finally {
      continuation.emit("release")
      await page.unrouteAll({ behavior: "wait" })
    }
  })
}, 300_000)
