import { execFileSync } from "node:child_process"
import { chromium, expect as visible } from "@playwright/test"
import { expect, it } from "vitest"
import { LibraryContext } from "../../apps/studio/src/library/client.ts"
import { startLocalMatrix } from "../deployment/matrix-deployments.ts"
import { syntheticEpub } from "../e2e/synthetic-epub.ts"

it("TEN-16 S1 F9 fits native controls and reachable numbered navigation in short windows", async () => {
  execFileSync("bun", ["run", "--cwd", "apps/studio", "build"], { stdio: "pipe" })
  const browser = await chromium.launch()
  const inherited = process.env["VITEST"]
  delete process.env["VITEST"]
  const running = await startLocalMatrix(browser).finally(() => {
    if (inherited !== undefined) process.env["VITEST"] = inherited
  })
  const { page, origin } = running.deployment
  try {
    await page.emulateMedia({ reducedMotion: "reduce" })
    await page.goto(`${origin}/login`)
    await page.getByLabel("Email").fill("owner@example.test")
    await page.getByLabel("Password").fill("correct horse battery staple")
    await page.getByRole("button", { name: "Log in", exact: true }).click()
    await page.waitForURL(`${origin}/`)
    await page.getByRole("status", { name: "Entering the library" }).waitFor({ state: "detached" })
    const route = page.getByRole("navigation", { name: "Reading route / 読書ルート" })
    await route.getByRole("button", { name: /Accession desk/ }).click()
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
          LibraryContext.parse(
            await (await page.request.get(`${origin}/api/library-context`)).json(),
          ).studies.length,
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
    await route.getByRole("button", { name: /Lending desk/ }).click()
    await page.getByRole("button", { name: "Review transmission", exact: true }).click()
    await page.getByRole("button", { name: "Send", exact: true }).click()
    await visible(page.getByRole("heading", { name: "Transmission approved" })).toBeVisible()
    await expect
      .poll(async () => (await page.request.get(`${origin}/api/interviews/${study.id}`)).status())
      .toBe(200)
    for (const viewport of [
      { width: 375, height: 700 },
      { width: 390, height: 700 },
      { width: 768, height: 700 },
      { width: 375, height: 844 },
      { width: 1280, height: 800 },
    ]) {
      await route.getByRole("button", { name: /Reference desk/ }).click()
      await page.setViewportSize(viewport)
      const input = page.getByLabel("Your own response")
      await visible(input).toBeVisible()
      const fit = await page.evaluate(() => {
        const pane = document.querySelector("#desk .desk-main")
        const footer = document.querySelector("#desk .desk-foot")
        const navigation = document.querySelector("#route")
        if (!pane || !footer || !navigation) throw new TypeError("Room frame missing")
        return {
          footerBottom: footer.getBoundingClientRect().bottom,
          navigationTop: navigation.getBoundingClientRect().top,
          viewportHeight: innerHeight,
          paneHeight: pane.clientHeight,
        }
      })
      expect(fit.footerBottom).toBeLessThanOrEqual(fit.viewportHeight)
      if (viewport.width < 960) expect(fit.footerBottom).toBeLessThanOrEqual(fit.navigationTop)
      await input.focus()
      await visible(input).toBeFocused()
      const initialInput = await input.boundingBox()
      const initialPane = await page.locator("#desk .desk-main").boundingBox()
      if (!initialInput || !initialPane) throw new TypeError("Native scroll bounds missing")
      await page.locator("#desk .desk-main").hover()
      await page.mouse.wheel(
        0,
        Math.ceil(
          Math.max(0, initialInput.y + initialInput.height - initialPane.y - initialPane.height),
        ),
      )
      await expect
        .poll(async () => {
          const bounds = await input.boundingBox()
          return bounds ? bounds.y + bounds.height : Number.POSITIVE_INFINITY
        })
        .toBeLessThanOrEqual(initialPane.y + initialPane.height)
      const inputBounds = await input.boundingBox()
      const paneBounds = await page.locator("#desk .desk-main").boundingBox()
      if (!inputBounds || !paneBounds) throw new TypeError("Native control bounds missing")
      expect(fit.paneHeight).toBeGreaterThan(inputBounds.height)
      expect(inputBounds.y).toBeGreaterThanOrEqual(paneBounds.y)
      expect(inputBounds.y + inputBounds.height).toBeLessThanOrEqual(
        paneBounds.y + paneBounds.height,
      )
      const control = route.getByRole("button", { name: /The stacks/ })
      const hit = await control.evaluate((element) => {
        const bounds = element.getBoundingClientRect()
        const target = document.elementFromPoint(
          bounds.x + bounds.width / 2,
          bounds.y + bounds.height / 2,
        )
        return target !== null && element.contains(target)
      })
      expect(hit).toBe(true)
      await control.click()
      await visible(page.locator("#desk-title")).toContainText("Read the source")
      expect(await page.locator("#desk .desk-main").evaluate((element) => element.scrollTop)).toBe(
        0,
      )
    }
  } finally {
    await running.stop()
    await browser.close()
  }
}, 300_000)
