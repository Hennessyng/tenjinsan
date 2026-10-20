import { execFileSync } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import { chromium, type Page, expect as visible } from "@playwright/test"
import { expect, it } from "vitest"
import { LibraryContext } from "../../apps/studio/src/library/client.ts"
import { startLocalMatrix } from "../deployment/matrix-deployments.ts"
import { syntheticEpub } from "../e2e/synthetic-epub.ts"

async function withRoom(verify: (page: Page, origin: string) => Promise<void>) {
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
    await route.getByRole("button", { name: /Reference desk/ }).click()
    await visible(page.getByLabel("Your own response")).toBeVisible()
    await verify(page, origin)
  } finally {
    await running.stop()
    await browser.close()
  }
}

it("TEN-16 S1 F8 keeps the study picker below visible headings at each viewport", async () => {
  await withRoom(async (page) => {
    const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()
    const evidence = `.sisyphus/runs/ten-16-bring-the-mockup-library-journey-into-tenjinsan/evidence/reconciliation-20261005/room-usability-${head}`
    await mkdir(evidence, { recursive: true })
    const measurements: {
      readonly width: number
      readonly titleBottom: number
      readonly pickerTop: number
      readonly position: string
      readonly paneHeight: number
      readonly bounded: boolean
    }[] = []
    for (const width of [375, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: width === 1280 ? 800 : 844 })
      const geometry = await page.evaluate(() => {
        const heading = document.querySelector("#desk-title")
        const picker = document.querySelector("#desk .study-selection")
        const pane = document.querySelector("#desk .desk-main")
        if (!heading || !picker || !pane) throw new TypeError("Room geometry missing")
        const title = heading.getBoundingClientRect()
        const selection = picker.getBoundingClientRect()
        return {
          titleBottom: title.bottom,
          pickerTop: selection.top,
          pickerLeft: selection.left,
          pickerRight: selection.right,
          position: getComputedStyle(picker).position,
          paneHeight: pane.clientHeight,
          bounded: document.documentElement.scrollWidth <= innerWidth,
        }
      })
      measurements.push({ width, ...geometry })
      await page.screenshot({ path: `${evidence}/${width}-reference.png` })
      await writeFile(`${evidence}/bounds.json`, JSON.stringify(measurements, null, 2))
      expect(geometry.pickerTop).toBeGreaterThanOrEqual(geometry.titleBottom)
      expect(geometry.pickerLeft).toBeGreaterThanOrEqual(0)
      expect(geometry.pickerRight).toBeLessThanOrEqual(width)
      expect(geometry.paneHeight).toBeGreaterThan(0)
      expect(geometry.bounded).toBe(true)
      const selector = page.getByLabel("Selected study / 選択した読書")
      await selector.focus()
      await visible(selector).toBeFocused()
      await page.keyboard.press("ArrowDown")
      await page.keyboard.press("ArrowUp")
    }
  })
}, 300_000)

it("TEN-16 S1 F8 resets a different room pane but retains same-room scroll and native focus", async () => {
  await withRoom(async (page, origin) => {
    await page.setViewportSize({ width: 375, height: 844 })
    const pane = page.locator("#desk .desk-main")
    await pane.hover()
    await page.mouse.wheel(0, 1200)
    await expect.poll(() => pane.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
    const previousScroll = await pane.evaluate((element) => element.scrollTop)
    expect((await page.request.get(`${origin}/api/library-context`)).status()).toBe(200)
    expect(await pane.evaluate((element) => element.scrollTop)).toBe(previousScroll)
    const route = page.getByRole("navigation", { name: "Reading route / 読書ルート" })
    await route.getByRole("button", { name: /Reading table/ }).click()
    await visible(page.locator("#desk-title")).toContainText("Review your reading brief")
    await expect.poll(() => pane.evaluate((element) => element.scrollTop)).toBe(0)
    await route.getByRole("button", { name: /Reference desk/ }).click()
    await visible(page.getByLabel("Your own response")).toBeVisible()
    expect(await pane.evaluate((element) => element.scrollTop)).toBe(0)
    const input = page.getByLabel("Your own response")
    await input.focus()
    const focusedScroll = await pane.evaluate((element) => element.scrollTop)
    expect((await page.request.get(`${origin}/api/library-context`)).status()).toBe(200)
    await visible(input).toBeFocused()
    expect(await pane.evaluate((element) => element.scrollTop)).toBe(focusedScroll)
  })
}, 300_000)
