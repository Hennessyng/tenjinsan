import { execFileSync } from "node:child_process"
import { chromium, expect as visible } from "@playwright/test"
import { expect, it } from "vitest"
import { sourceViewerFixture } from "../../apps/server/src/testing/source-viewer-fixture.ts"
import { LibraryContext } from "../../apps/studio/src/library/client.ts"
import { SetupChoices } from "../../apps/studio/src/study-setup/client.ts"

it("TEN-16 S1 F1 opens the requested owned setup when its edition has multiple normalizations", async () => {
  execFileSync("bun", ["run", "--cwd", "apps/studio", "build"], { stdio: "pipe" })
  const fixture = await sourceViewerFixture({ studioAssets: true })
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ reducedMotion: "reduce" })
    await page.goto(`${fixture.origin}/login`)
    await page.getByLabel("Email").fill(fixture.credentials.email)
    await page.getByLabel("Password").fill(fixture.credentials.password)
    await page.getByRole("button", { name: "Log in" }).click()
    await page.waitForURL(`${fixture.origin}/`)
    const response = await page.request.get(`${fixture.origin}/api/library-context`)
    expect(response.status()).toBe(200)
    const before = LibraryContext.parse(await response.json())
    expect(before.selectedStudyId).toBeNull()
    const study = before.studies.find((entry) => entry.id === "study-fixture")
    expect([...(study?.normalizations ?? [])].sort()).toEqual([
      "revision-fixture",
      "revision-other",
    ])
    expect(study?.normalizationId).toBeNull()
    const mutations: string[] = []
    page.on("request", (request) => {
      if (request.method() === "POST") mutations.push(new URL(request.url()).pathname)
    })

    for (const normalization of ["revision-fixture", "revision-other"]) {
      const setup = await page.request.get(`${fixture.origin}/api/study-setup/${normalization}`)
      expect(setup.status()).toBe(200)
      const choices = SetupChoices.parse(await setup.json())
      const contextRead = page.waitForResponse((reply) =>
        reply.url().endsWith("/api/library-context"),
      )
      await page.goto(`${fixture.origin}/sources/${normalization}/setup`)
      expect((await contextRead).status()).toBe(200)
      await visible(page.locator(".sheet")).toBeVisible()
      await visible(page.getByRole("status").filter({ hasText: /Checking|Loading/ })).toHaveCount(0)
      const select = page.getByRole("combobox", { name: "Provider and model", exact: true })

      expect(
        await select.count(),
        `Real setup controls for explicitly requested ${normalization}`,
      ).toBe(1)
      await visible(select).toBeVisible()
      expect(await select.locator("option").allTextContents()).toEqual(
        choices.choices.map((choice) => choice.label),
      )
      await select.focus()
      await visible(select).toBeFocused()
      expect(new URL(page.url()).pathname).toBe(`/sources/${normalization}/setup`)
    }
    for (const normalization of ["foreign-revision", "missing"]) {
      expect(
        (await page.request.get(`${fixture.origin}/api/study-setup/${normalization}`)).status(),
      ).toBe(404)
      await page.goto(`${fixture.origin}/sources/${normalization}/setup`)
      await visible(page.locator(".sheet")).toContainText("Choose an owned study to continue.")
      expect(
        await page.getByRole("combobox", { name: "Provider and model", exact: true }).count(),
      ).toBe(0)
    }
    const after = LibraryContext.parse(
      await (await page.request.get(`${fixture.origin}/api/library-context`)).json(),
    )
    expect(after).toEqual(before)
    expect(mutations).toEqual([])
  } finally {
    await browser.close()
    await fixture.close()
  }
}, 120_000)
