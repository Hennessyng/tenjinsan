import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { expect, test } from "@playwright/test"
import { sourceViewerFixture } from "@reading-studio/server/source-viewer-fixture"

const evidence = ".omo/evidence/TEN-21/dual-local-login"
for (const deployment of ["local", "hosted"] as const) {
  test.describe(`TEN-21 ${deployment} offline Setup`, () => {
    let fixture: Awaited<ReturnType<typeof sourceViewerFixture>>
    let binaryDirectory: string
    let previousBinary: string | undefined
    let previousGrokBinary: string | undefined
    test.beforeAll(async () => {
      await mkdir(evidence, { recursive: true })
      binaryDirectory = await mkdtemp(join(tmpdir(), "ten21-browser-codex-"))
      previousBinary = process.env["STUDIO_SUBSCRIPTION_CODEX_BINARY"]
      const binary = join(binaryDirectory, "codex-fixture")
      await writeFile(
        binary,
        `#!/bin/sh\nexec "${process.execPath}" "${resolve("packages/storage/tests/subscription-codex-fixture.cjs")}" "$@"\n`,
        { mode: 0o700 },
      )
      process.env["STUDIO_SUBSCRIPTION_CODEX_BINARY"] = binary
      previousGrokBinary = process.env["STUDIO_SUBSCRIPTION_GROK_BINARY"]
      const grok = join(binaryDirectory, "grok-fixture")
      await writeFile(
        grok,
        `#!/bin/sh\nexec "${process.execPath}" "${resolve("packages/storage/tests/subscription-grok-fixture.cjs")}" "$@"\n`,
        { mode: 0o700 },
      )
      process.env["STUDIO_SUBSCRIPTION_GROK_BINARY"] = grok
      fixture = await sourceViewerFixture({
        studioAssets: true,
        serverHost: deployment === "local" ? "127.0.0.1" : "0.0.0.0",
      })
    })
    test.afterAll(async () => {
      await fixture.close()
      if (previousBinary === undefined) delete process.env["STUDIO_SUBSCRIPTION_CODEX_BINARY"]
      else process.env["STUDIO_SUBSCRIPTION_CODEX_BINARY"] = previousBinary
      if (previousGrokBinary === undefined) delete process.env["STUDIO_SUBSCRIPTION_GROK_BINARY"]
      else process.env["STUDIO_SUBSCRIPTION_GROK_BINARY"] = previousGrokBinary
      await rm(binaryDirectory, { recursive: true, force: true })
    })
    for (const width of [375, 768, 1280]) {
      test(`shows blocked routes and local-only actions at ${width}px`, async ({ page }) => {
        // Given
        const external: string[] = []
        const errors: string[] = []
        page.on("pageerror", (error) => errors.push(error.message))
        await page.route("**/*", (route) => {
          if (new URL(route.request().url()).hostname === "127.0.0.1") return route.continue()
          external.push(route.request().url())
          return route.abort()
        })
        await page.setViewportSize({ width, height: 900 })
        // When
        await page.goto(`${fixture.origin}/sources/revision-fixture/setup`)
        // Then
        const panel = page.getByRole("region", {
          name: "Local subscription connections",
        })
        for (const provider of ["ChatGPT", "Claude", "Grok"]) {
          const entry = panel.getByRole("region", { name: provider, exact: true })
          const connect = entry.getByRole("button", { name: `Connect ${provider}`, exact: true })
          if (deployment === "local" && provider !== "Claude") await expect(connect).toBeEnabled()
          else await expect(connect).toBeDisabled()
          if (provider === "Claude") {
            await entry.getByText("Remaining sending safeguards", { exact: true }).click()
            await expect(
              entry.getByText(
                "Exclusion of credits, overage and separately billed tools is not established.",
                { exact: true },
              ),
            ).toBeVisible()
          } else
            await expect(entry.getByText(/Provider-managed subscription billing/)).toBeVisible()
          await entry.getByRole("heading", { name: provider, exact: true }).scrollIntoViewIfNeeded()
          await expect(entry.getByRole("heading", { name: provider, exact: true })).toBeVisible()
          await page.screenshot({
            path: `${evidence}/${deployment}-${width}-${provider}.png`,
            fullPage: true,
          })
        }
        await expect(page.getByRole("button", { name: "Connect Codex", exact: true })).toBeEnabled()
        await expect(page.getByRole("combobox", { name: "Provider and model" })).toContainText(
          "Anthropic",
        )
        const refresh = panel.getByRole("button", { name: "Refresh subscription prerequisites" })
        await refresh.focus()
        await expect(refresh).toBeFocused()
        await page.keyboard.press("Enter")
        await expect(refresh).toBeEnabled()
        if (deployment === "local") {
          for (const provider of ["ChatGPT", "Grok"]) {
            const chatgpt = panel.getByRole("region", { name: provider, exact: true })
            await chatgpt.getByRole("button", { name: `Connect ${provider}`, exact: true }).click()
            await expect(chatgpt.getByRole("status")).toHaveText(
              "Signed in — review before sending",
            )
            await expect(
              chatgpt.getByRole("list", { name: "Models reported by your local tool" }),
            ).toContainText(provider === "ChatGPT" ? "offered/model" : "offered-grok")
            await page.reload()
            await expect(chatgpt.getByRole("status")).toHaveText(
              "Signed in — review before sending",
            )
            await chatgpt
              .getByRole("heading", { name: provider, exact: true })
              .scrollIntoViewIfNeeded()
            await page.screenshot({
              path: `${evidence}/local-${width}-${provider}-connected.png`,
              fullPage: true,
            })
            await chatgpt.getByRole("button", { name: "Refresh account and models" }).click()
            await expect(
              chatgpt.getByRole("button", { name: "Refresh account and models" }),
            ).toBeEnabled()
            await chatgpt.getByRole("button", { name: `Disconnect local ${provider} slot` }).click()
            await expect(chatgpt.getByRole("status")).toHaveText(
              "Locally disconnected — route still unverified",
            )
          }
          await panel.getByRole("button", { name: "Disconnect local Claude slot" }).click()
          await expect(
            panel.getByRole("region", { name: "Claude", exact: true }).getByRole("status"),
          ).toHaveText("Locally disconnected — route still unverified")
        } else {
          await expect(panel.getByRole("button", { name: /^Disconnect local/ })).toHaveCount(0)
          await expect(
            panel.getByText(/Use an explicitly configured OpenRouter route in production/),
          ).toBeVisible()
        }
        await panel.scrollIntoViewIfNeeded()
        await page.screenshot({ path: `${evidence}/${deployment}-${width}-en.png`, fullPage: true })
        expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
          true,
        )
        await page.goto(`${fixture.origin}/sources/revision-fixture/setup?lang=ja`)
        await expect(page.getByRole("heading", { name: "ローカル契約接続" })).toBeVisible()
        await page.getByRole("heading", { name: "ローカル契約接続" }).scrollIntoViewIfNeeded()
        await page.screenshot({ path: `${evidence}/${deployment}-${width}-ja.png`, fullPage: true })
        expect(external).toEqual([])
        expect(errors).toEqual([])
        expect(fixture.storage.counts()).toMatchObject({ grants: 0, attempts: 0, jobs: 0 })
      })
    }
  })
}

test("reports failed diagnostics without enabling subscription use", async ({ page }) => {
  // Given
  const fixture = await sourceViewerFixture({ studioAssets: true, serverHost: "127.0.0.1" })
  try {
    await page.route("**/api/subscription-connections", (route) =>
      route.fulfill({ status: 503, body: "{}" }),
    )
    // When
    await page.goto(`${fixture.origin}/sources/revision-fixture/setup`)
    // Then
    await expect(page.locator('[data-subscription-error="discovery-failed"]')).toBeVisible()
    for (const width of [375, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 })
      await page.locator('[data-subscription-error="discovery-failed"]').scrollIntoViewIfNeeded()
      await page.screenshot({ path: `${evidence}/diagnostics-failed-${width}.png`, fullPage: true })
    }
    expect(fixture.storage.counts()).toMatchObject({ grants: 0, attempts: 0, jobs: 0 })
  } finally {
    await fixture.close()
  }
})
