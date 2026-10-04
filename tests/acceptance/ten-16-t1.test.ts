import { execFileSync } from "node:child_process"
import { expect as browserExpect, chromium } from "@playwright/test"
import { expect, it } from "vitest"
import { LocalLauncher, makeLocalFixture, removeLocalFixture } from "../deployment/local-fixture.ts"

it("TEN-16 S1 T1 authenticates before the copied entrance opens", async () => {
  execFileSync("bun", ["run", "--cwd", "apps/studio", "build"], { stdio: "pipe" })
  const fixture = await makeLocalFixture(true)
  const launcher = new LocalLauncher(fixture.environment)
  const browser = await chromium.launch()
  try {
    const ready = await launcher.ready()
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    await page.goto(`${ready.apiUrl}/login`)
    await page.getByLabel("Email").fill("owner@example.test")
    await page.getByLabel("Password").fill("invalid disposable password")
    await page.getByRole("button", { name: "Log in", exact: true }).click()
    await browserExpect(page.getByRole("alert")).toContainText("Check your credentials")
    expect(new URL(page.url()).pathname).toBe("/login")
    await browserExpect(page.getByRole("button", { name: "Log in", exact: true })).toBeEnabled()
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0)
    await page.getByLabel("Email").fill("owner@example.test")
    await page.getByLabel("Password").fill("correct horse battery staple")
    await page.getByRole("button", { name: "Log in", exact: true }).click()
    await page.waitForURL(`${ready.apiUrl}/`)
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.getAnimations().filter((animation) => {
              const effect = animation.effect
              return (
                effect instanceof KeyframeEffect &&
                effect
                  .getKeyframes()
                  .some(
                    (frame) => typeof frame.transform === "string" && frame.transform !== "none",
                  )
              )
            }).length,
        ),
      )
      .toBeGreaterThan(0)
    await browserExpect(page.getByRole("status", { name: "Entering the library" })).toHaveCount(0)
    expect(await page.evaluate(() => document.activeElement?.closest("nav") !== null)).toBe(true)
    await page.reload()
    await browserExpect(page.getByRole("status", { name: "Entering the library" })).toHaveCount(0)
    await page.getByRole("button", { name: "Log out", exact: true }).click()
    await page.waitForURL(`${ready.apiUrl}/login`)
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 1280, height: 400 },
    ]) {
      await page.setViewportSize(viewport)
      await page.goto(`${ready.apiUrl}/login`)
      await browserExpect(page.getByLabel("Email")).toBeEditable()
      await browserExpect(page.getByLabel("Password")).toBeEditable()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
      await page.getByRole("button", { name: "Log in", exact: true }).focus()
      await browserExpect(page.getByRole("button", { name: "Log in", exact: true })).toBeFocused()
    }
    await page.emulateMedia({ reducedMotion: "reduce" })
    await page.getByLabel("Email").fill("owner@example.test")
    await page.getByLabel("Password").fill("correct horse battery staple")
    await page.getByRole("button", { name: "Log in", exact: true }).click()
    await page.waitForURL(`${ready.apiUrl}/`)
    await browserExpect(page.getByRole("status", { name: "Entering the library" })).toHaveCount(0)
  } finally {
    await browser.close()
    launcher.forceStop()
    await launcher.waitForExit()
    await removeLocalFixture(fixture)
  }
}, 300_000)
