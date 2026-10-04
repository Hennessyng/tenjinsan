import { execFileSync } from "node:child_process"
import { expect as browserExpect, chromium } from "@playwright/test"
import { sourceViewerFixture } from "@reading-studio/server/source-viewer-fixture"
import { expect, it } from "vitest"
import { SetupChoices } from "../../apps/studio/src/study-setup/client.ts"

it("presents provider and connection details as lending-desk paper", async () => {
  // Given: the built studio and a disposable owner with actual public setup choices.
  execFileSync("bun", ["run", "--cwd", "apps/studio", "build"], { stdio: "pipe" })
  const fixture = await sourceViewerFixture({ studioAssets: true })
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.goto(`${fixture.origin}/login`)
    await page.getByLabel("Email").fill(fixture.credentials.email)
    await page.getByLabel("Password").fill(fixture.credentials.password)
    await page.getByRole("button", { name: "Log in" }).click()
    await page.waitForURL(`${fixture.origin}/`)
    const response = await page.request.get(`${fixture.origin}/api/study-setup/revision-fixture`)
    const offered = SetupChoices.parse(await response.json())
    for (const width of [375, 768, 1280]) {
      // When: the owner views the existing Provider and model control.
      await page.setViewportSize({ width, height: 900 })
      await page.goto(`${fixture.origin}/sources/revision-fixture/setup`)
      const select = page.getByRole("combobox", { name: "Provider and model", exact: true })
      await browserExpect(select).toBeVisible()
      // Then: a single native selector retains the actual choices on a bounded paper field.
      const paper = page.getByRole("region", { name: "Provider and model", exact: true })
      expect(await paper.count()).toBe(1)
      expect(await paper.getByRole("combobox").count()).toBe(1)
      expect(await select.evaluate((element) => element.tagName)).toBe("SELECT")
      expect(await select.locator("option").allTextContents()).toEqual(
        offered.choices.map((choice) => choice.label),
      )
      const material = await paper.evaluate((element) => {
        const style = getComputedStyle(element)
        const box = element.getBoundingClientRect()
        return {
          background: style.backgroundColor,
          rule: style.borderTopStyle,
          padding: Number.parseFloat(style.paddingInlineStart),
          bounded: box.left >= 0 && box.right <= innerWidth,
        }
      })
      expect(material).toMatchObject({
        background: "rgb(255, 253, 248)",
        rule: "solid",
        bounded: true,
      })
      expect(material.padding).toBeGreaterThanOrEqual(16)
      const connectionSlip = page.getByRole("region", { name: "Connection methods", exact: true })
      await browserExpect(connectionSlip).toBeVisible()
      await browserExpect(connectionSlip).toContainText(
        "OpenRouter and Anthropic use server-owned API keys.",
      )
      for (const control of [
        "Connect Codex",
        "Disconnect Codex",
        "Refresh connection and models",
      ]) {
        await browserExpect(
          connectionSlip.getByRole("button", { name: control, exact: true }),
        ).toBeVisible()
      }
      const slipBackground = await connectionSlip.evaluate(
        (element) => getComputedStyle(element).backgroundImage,
      )
      expect(slipBackground).toContain("repeating-linear-gradient")
      const stamp = connectionSlip.getByRole("status")
      await browserExpect(stamp).toHaveText(/^(Connected|Unavailable)$/)
      expect(await stamp.evaluate((element) => getComputedStyle(element).textTransform)).toBe(
        "uppercase",
      )
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
      await select.focus()
      await browserExpect(select).toBeFocused()
    }
  } finally {
    await browser.close()
    await fixture.close()
  }
}, 90_000)
