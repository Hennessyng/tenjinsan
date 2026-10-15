import { execFileSync } from "node:child_process"
import { EventEmitter, once } from "node:events"
import { chromium, expect as visible } from "@playwright/test"
import { expect, it } from "vitest"
import { LibraryContext } from "../../apps/studio/src/library/client.ts"
import { startLocalMatrix } from "../deployment/matrix-local.ts"
import { syntheticEpub } from "../e2e/synthetic-epub.ts"

it("opens the confirmed study source while its context refresh is delayed", async () => {
  // Given a real normalized study and a settled hall with no selected study.
  execFileSync("bun", ["run", "--cwd", "apps/studio", "build"], { stdio: "pipe" })
  const browser = await chromium.launch()
  const inherited = process.env["VITEST"]
  delete process.env["VITEST"]
  const running = await startLocalMatrix(browser).finally(() => {
    if (inherited !== undefined) process.env["VITEST"] = inherited
  })
  const { page, origin } = running.deployment
  const events = new EventEmitter()
  try {
    await page.goto(`${origin}/login`)
    await page.getByLabel("Email").fill("owner@example.test")
    await page.getByLabel("Password").fill("correct horse battery staple")
    await page.getByRole("button", { name: "Log in", exact: true }).click()
    await page.waitForURL(`${origin}/`)
    await page.getByRole("status", { name: "Entering the library" }).waitFor({ state: "detached" })
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
    const study = (await context()).studies[0]
    if (!study?.normalizationId) throw new TypeError("Normalized study missing")
    await page.reload()
    await page.getByRole("status", { name: "Entering the library" }).waitFor({ state: "detached" })
    const selection = page.getByLabel("Selected study / 選択した読書")
    await visible(selection.locator("option")).toHaveCount(2)
    await selection.selectOption(study.id)
    const received = once(events, "received", { signal: AbortSignal.timeout(15000) })
    const release = once(events, "release")
    await page.route("**/api/library-context", async (route) => {
      events.emit("received")
      await release
      await route.continue()
    })
    const confirmed = page.waitForResponse((response) =>
      response.url().endsWith("/api/library-selection"),
    )
    // When selection is confirmed but its following context read has not completed.
    await page.getByRole("button", { name: "Select study / 読書を選ぶ", exact: true }).click()
    expect((await confirmed).status()).toBe(200)
    await received
    await page
      .getByRole("navigation", { name: "Reading route / 読書ルート" })
      .getByRole("button", { name: /The stacks/ })
      .click()
    // Then the destination is that study's source, never the unselected source list.
    await visible(page).toHaveURL(`${origin}/sources/${study.normalizationId}`)
    events.emit("release")
    await visible(page.getByRole("heading", { name: study.title, exact: true })).toBeVisible()
  } finally {
    events.emit("release")
    await page.unrouteAll({ behavior: "wait" })
    await running.stop()
    await browser.close()
  }
}, 90_000)
