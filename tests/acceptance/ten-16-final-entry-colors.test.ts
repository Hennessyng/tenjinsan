import { execFileSync } from "node:child_process"
import { chromium, expect as visible } from "@playwright/test"
import { expect, it } from "vitest"
import { LocalLauncher, makeLocalFixture, removeLocalFixture } from "../deployment/local-fixture.ts"

it("TEN-16 S1 F5 preserves the copied entrance colors after real login under strict CSP", async () => {
  execFileSync("bun", ["run", "--cwd", "apps/studio", "build"], { stdio: "pipe" })
  const fixture = await makeLocalFixture(true)
  const environment: NodeJS.ProcessEnv = { ...fixture.environment }
  delete environment["STUDIO_SYNTHETIC_TEST_MODE"]
  const launcher = new LocalLauncher(environment)
  const browser = await chromium.launch()
  try {
    const { apiUrl } = await launcher.ready()
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    const violations: string[] = []
    page.on("console", (message) => {
      if (/inline style violates.*Content Security Policy/.test(message.text()))
        violations.push(message.text())
    })
    await page.goto(`${apiUrl}/login`)
    await page.getByLabel("Email").fill("owner@example.test")
    await page.getByLabel("Password").fill("incorrect disposable password")
    await page.getByRole("button", { name: "Log in", exact: true }).click()
    await visible(page.getByRole("alert")).toBeVisible()
    await visible(page.getByRole("status", { name: "Entering the library" })).toHaveCount(0)
    await page.getByLabel("Email").fill("owner@example.test")
    await page.getByLabel("Password").fill("correct horse battery staple")
    await page.getByRole("button", { name: "Log in", exact: true }).click()
    await page.waitForURL(`${apiUrl}/`, { waitUntil: "domcontentloaded" })
    await visible(page.getByRole("status", { name: "Entering the library" })).toBeVisible()
    const colors = await page.locator(".gate-scene").evaluate((scene) => ({
      stops: Array.from(scene.querySelectorAll("#sc-sky stop, #sc-gravel stop, #sc-path stop")).map(
        (stop) => getComputedStyle(stop).stopColor,
      ),
      flowers: Array.from(scene.querySelectorAll("#plum-blossoms use")).map(
        (flower) => getComputedStyle(flower).color,
      ),
    }))
    expect(colors.stops).toEqual([
      "rgb(169, 205, 198)",
      "rgb(241, 233, 211)",
      "rgb(211, 196, 160)",
      "rgb(191, 174, 133)",
      "rgb(239, 235, 223)",
      "rgb(220, 215, 198)",
    ])
    expect(colors.flowers.length).toBeGreaterThan(0)
    expect(new Set(colors.flowers)).toEqual(new Set(["rgb(251, 243, 238)", "rgb(184, 69, 106)"]))
    expect(violations).toEqual([])
    await page.getByRole("status", { name: "Entering the library" }).waitFor({ state: "detached" })
    await visible(page.locator("main#library")).toBeVisible()
    await page.reload()
    await visible(page.getByRole("status", { name: "Entering the library" })).toHaveCount(0)
    await page.getByRole("button", { name: "Log out", exact: true }).click()
    await page.emulateMedia({ reducedMotion: "reduce" })
    await page.getByLabel("Email").fill("owner@example.test")
    await page.getByLabel("Password").fill("correct horse battery staple")
    await page.getByRole("button", { name: "Log in", exact: true }).click()
    await page.waitForURL(`${apiUrl}/`)
    await visible(page.getByRole("status", { name: "Entering the library" })).toHaveCount(0)
    await visible(page.locator("main#library")).toBeVisible()
    expect(violations).toEqual([])
  } finally {
    await browser.close()
    launcher.forceStop()
    await launcher.waitForExit()
    await removeLocalFixture(fixture)
  }
}, 300_000)
