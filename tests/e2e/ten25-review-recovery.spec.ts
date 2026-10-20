import { mkdir } from "node:fs/promises"
import { expect, test } from "@playwright/test"
import { ProviderError } from "@reading-studio/providers"
import { sourceViewerFixture } from "@reading-studio/server/source-viewer-fixture"
import { studySetupSend } from "@reading-studio/server/study-setup-send"
import { z } from "zod"

const evidence = ".omo/evidence/TEN-25/review-fixes"
const openrouterKey = "OPENROUTER_API_KEY"
const anthropicKey = "ANTHROPIC_API_KEY"
let previousCredentials: { openrouter: string | undefined; anthropic: string | undefined }
test.beforeEach(() => {
  previousCredentials = {
    openrouter: process.env[openrouterKey],
    anthropic: process.env[anthropicKey],
  }
  process.env[openrouterKey] = ""
  process.env[anthropicKey] = ""
})
test.afterEach(() => {
  if (previousCredentials.openrouter === undefined) delete process.env[openrouterKey]
  else process.env[openrouterKey] = previousCredentials.openrouter
  if (previousCredentials.anthropic === undefined) delete process.env[anthropicKey]
  else process.env[anthropicKey] = previousCredentials.anthropic
})
for (const width of [375, 768, 1280]) {
  test(`saved refusal keeps a consent-only heading and no Resume across reload at ${width}px`, async ({
    page,
  }) => {
    // Given
    let schedules = 0
    const fixture = await sourceViewerFixture({
      studioAssets: true,
      onSetupSend: () => {
        schedules += 1
        throw new ProviderError("unsupported-model")
      },
    })
    const locale = width === 768 ? "ja" : "en"
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.name))
    await page.route("**/*", (route) =>
      new URL(route.request().url()).origin === fixture.origin ? route.continue() : route.abort(),
    )
    await mkdir(evidence, { recursive: true })
    try {
      await page.setViewportSize({ width, height: 900 })
      const draft = await page.request.post(`${fixture.origin}/api/study-setup/revision-fixture`, {
        headers: { origin: fixture.origin },
        data: { provider: "anthropic" },
      })
      const { setupId } = z.object({ setupId: z.string() }).parse(await draft.json())
      await page.goto(`${fixture.origin}/sources/revision-fixture/setup/${setupId}?lang=${locale}`)
      // When
      await page
        .getByRole("button", { name: locale === "ja" ? "送信" : "Send", exact: true })
        .click()
      // Then
      const heading = locale === "ja" ? "同意を保存しました" : "Consent saved"
      await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible()
      await expect(page.getByRole("alert")).toContainText("unsupported-model")
      await expect(
        page.getByRole("button", {
          name: locale === "ja" ? "予約を再開" : "Resume scheduling",
          exact: true,
        }),
      ).toHaveCount(0)
      await page.reload()
      await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible()
      await expect(page.getByRole("alert")).toContainText("unsupported-model")
      await expect(
        page.getByRole("button", {
          name: locale === "ja" ? "予約を再開" : "Resume scheduling",
          exact: true,
        }),
      ).toHaveCount(0)
      await page.getByRole("alert").scrollIntoViewIfNeeded()
      await page.screenshot({ path: `${evidence}/blocked-${locale}-${width}.png`, fullPage: true })
      expect(schedules).toBe(1)
      expect(fixture.storage.counts()).toMatchObject({ grants: 1, jobs: 0, attempts: 0 })
      expect(errors).toEqual([])
    } finally {
      await page.context().close()
      await fixture.close()
    }
  })

  test(`explicit Resume schedules with the existing consent while repeated Send only reads status at ${width}px`, async ({
    page,
  }) => {
    // Given
    let schedules = 0
    let enqueue: ReturnType<typeof studySetupSend> = () => {
      throw new TypeError("Synthetic enqueue not initialized")
    }
    const fixture = await sourceViewerFixture({
      studioAssets: true,
      onSetupSend: (input) => {
        schedules += 1
        if (schedules === 1) throw new TypeError("Synthetic scheduling interruption")
        enqueue(input)
      },
    })
    enqueue = studySetupSend(fixture.storage)
    const external: string[] = []
    await page.route("**/*", (route) => {
      if (new URL(route.request().url()).origin === fixture.origin) return route.continue()
      external.push(new URL(route.request().url()).hostname)
      return route.abort()
    })
    await mkdir(evidence, { recursive: true })
    try {
      await page.setViewportSize({ width, height: 900 })
      const draft = await page.request.post(`${fixture.origin}/api/study-setup/revision-fixture`, {
        headers: { origin: fixture.origin },
        data: { provider: "anthropic" },
      })
      const { setupId } = z.object({ setupId: z.string() }).parse(await draft.json())
      await page.goto(`${fixture.origin}/sources/revision-fixture/setup/${setupId}?lang=en`)
      await page.getByRole("button", { name: "Send", exact: true }).click()
      await expect(page.getByRole("heading", { name: "Consent saved", exact: true })).toBeVisible()
      await page
        .getByRole("button", { name: "Resume scheduling", exact: true })
        .scrollIntoViewIfNeeded()
      await page.screenshot({ path: `${evidence}/incomplete-${width}.png`, fullPage: true })
      // When
      await page.getByRole("button", { name: "Resume scheduling", exact: true }).click()
      // Then
      await expect(page.locator('[data-analysis-progress="queued"]')).toBeVisible()
      await expect(
        page.getByRole("heading", { name: "Transmission approved", exact: true }),
      ).toBeVisible()
      await expect(
        page.getByRole("button", { name: "Resume scheduling", exact: true }),
      ).toHaveCount(0)
      const replay = await page.request.post(
        `${fixture.origin}/api/study-setup/revision-fixture/${setupId}`,
        { headers: { origin: fixture.origin }, data: { decision: "send" } },
      )
      expect(replay.status()).toBe(200)
      expect(await replay.json()).toMatchObject({
        grantId: `grant-${setupId}`,
        analysisProgress: "queued",
        canResume: false,
      })
      await page.reload()
      await expect(page.locator('[data-analysis-progress="queued"]')).toBeVisible()
      await page.screenshot({ path: `${evidence}/resumed-${width}.png`, fullPage: true })
      expect(schedules).toBe(2)
      expect(fixture.storage.counts().grants).toBe(1)
      expect(fixture.storage.counts().attempts).toBe(0)
      expect(external).toEqual([])
    } finally {
      await page.context().close()
      await fixture.close()
    }
  })
}
