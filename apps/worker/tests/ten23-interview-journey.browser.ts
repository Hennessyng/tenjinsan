import { mkdir } from "node:fs/promises"
import { expect, test } from "@playwright/test"
import { uploadHarness } from "@reading-studio/server/upload-fixture"
import { z } from "zod"
import { interviewWorker } from "./ten23-fixture.ts"

for (const width of [375, 768, 1280]) {
  test(`explicit fixture Send reaches saved questions and durable answers at ${width}px`, async ({
    page,
    request,
  }) => {
    // Given
    const fixture = await uploadHarness({
      studioAssets: true,
      providerAvailable: true,
      queueAnalysis: true,
    })
    const evidence = ".sisyphus/runs/TEN-23/review-screenshots"
    await mkdir(evidence, { recursive: true })
    const external: string[] = []
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))
    await page.route("**/*", (route) => {
      if (new URL(route.request().url()).origin === fixture.origin) return route.continue()
      external.push(route.request().url())
      return route.abort()
    })
    let worker: Awaited<ReturnType<typeof interviewWorker>> | undefined
    try {
      const imported = await request.post(`${fixture.origin}/api/imports/upload`, {
        headers: { origin: fixture.origin, "content-type": "text/plain" },
        data: "Synthetic book: asking careful questions helps readers notice what matters.",
      })
      expect(imported.status()).toBe(202)
      const { normalizationRevisionId: revision } = z
        .object({ normalizationRevisionId: z.string() })
        .parse(await imported.json())
      const normalization = fixture.sourceStorage.sources.getNormalization(revision)
      if (!normalization) throw new TypeError("Missing fixture normalization")
      const study = fixture.sourceStorage.sources.listStudiesByEdition(normalization.editionId)[0]
      if (!study) throw new TypeError("Missing fixture study")
      const interview = `${fixture.origin}/interviews/${study.id}`
      await page.setViewportSize({ width, height: 900 })
      await page.goto(`${interview}?lang=en`)
      await expect(page.getByRole("heading", { name: "Complete study setup" })).toBeVisible()
      await page.screenshot({ path: `${evidence}/${width}-setup-required.png`, fullPage: true })
      expect(fixture.sourceStorage.counts()).toMatchObject({ grants: 0, jobs: 0, attempts: 0 })
      await page.getByRole("link", { name: "Complete study setup", exact: true }).click()
      await page
        .getByRole("combobox", { name: "Provider and model" })
        .selectOption({ label: "Anthropic / Claude Sonnet 4.6" })
      await page.getByRole("radio", { name: /^Whole document/ }).check()
      await page.getByRole("button", { name: "Review transmission", exact: true }).click()
      await expect(page.getByRole("heading", { name: "Review transmission" })).toBeVisible()
      const setup = fixture.sourceStorage.sources.getLatestSetup(study.id)
      if (!setup) throw new TypeError("Missing reviewed setup")
      await page.goto(`${interview}?lang=en`)
      await expect(page.getByRole("heading", { name: "Review setup before sending" })).toBeVisible()
      expect(fixture.sourceStorage.counts()).toMatchObject({ grants: 0, jobs: 0, attempts: 0 })
      await page.getByRole("link", { name: "Review setup before sending", exact: true }).click()
      await expect(
        page.getByRole("heading", { name: "Review transmission", exact: true }),
      ).toBeVisible()
      await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled()
      await page
        .getByRole("heading", { name: "Review transmission", exact: true })
        .scrollIntoViewIfNeeded()
      await page.screenshot({ path: `${evidence}/${width}-review.png`, fullPage: true })
      // When
      await page.getByRole("button", { name: "Send", exact: true }).click()
      await expect(page.getByRole("heading", { name: "Transmission approved" })).toBeVisible()
      await page.goto(interview)
      await expect(page.getByRole("heading", { name: "Source analysis" })).toBeVisible()
      await page.screenshot({ path: `${evidence}/${width}-analysis-queued.png`, fullPage: true })
      worker = await interviewWorker(fixture.sourceStorage, setup.id)
      const analysis = await worker.runAnalysis()
      expect(analysis.kind === "provider" ? analysis.job.state : analysis.kind).toBe("completed")
      worker.queueQuestions()
      await page.reload()
      await expect(page.getByRole("heading", { name: "Question generation" })).toBeVisible()
      await page.screenshot({ path: `${evidence}/${width}-questions-queued.png`, fullPage: true })
      const questions = await worker.runQuestions()
      expect(
        questions.kind === "provider"
          ? {
              state: questions.job.state,
              error: questions.job.state === "failed" ? questions.job.error.code : null,
            }
          : { state: questions.kind, error: null },
      ).toEqual({ state: "completed", error: null })
      await page.getByRole("link", { name: "View progress and next actions" }).click()
      await page.getByRole("link", { name: "Interview questions", exact: true }).first().click()
      await expect(page.getByRole("heading", { name: "Which skill matters?" })).toBeVisible()
      await page.getByRole("radio", { name: "Listen", exact: true }).check()
      await page.getByRole("button", { name: "Save choices", exact: true }).click()
      // Then
      await expect(page.getByRole("status").filter({ hasText: "Answer saved" })).toBeVisible()
      await page.reload()
      await expect(page.getByRole("radio", { name: "Listen", exact: true })).toBeChecked()
      await page.getByRole("link", { name: "日本語", exact: true }).click()
      await expect(page.getByRole("heading", { name: "どの力が大切ですか？" })).toBeVisible()
      await expect(page.getByRole("radio", { name: "聴く", exact: true })).toBeChecked()
      await page.screenshot({ path: `${evidence}/${width}-saved-japanese.png`, fullPage: true })
      await page.getByRole("radio", { name: "聴く", exact: true }).scrollIntoViewIfNeeded()
      await page.screenshot({
        path: `${evidence}/${width}-saved-japanese-answer.png`,
        fullPage: true,
      })
      await page.getByRole("link", { name: "次へ", exact: true }).click()
      await expect(page.getByRole("heading", { name: "どこで実践しますか？" })).toBeVisible()
      const saved = fixture.sourceStorage.interviews.latest(study.id)
      await request.post(`${fixture.origin}/api/study-setup/${revision}`, {
        headers: { origin: fixture.origin },
        data: { provider: "anthropic", scope: "whole-document" },
      })
      await page.goto(`${interview}?lang=en`)
      await expect(page.getByRole("radio", { name: "Listen", exact: true })).toBeChecked()
      expect(fixture.sourceStorage.interviews.latest(study.id)).toEqual(saved)
      expect(worker.wire.requests).toHaveLength(2)
      expect(fixture.sourceStorage.counts()).toMatchObject({ grants: 1, attempts: 2 })
      expect(external).toEqual([])
      expect(errors).toEqual([])
      expect(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")).toBe(
        true,
      )
    } finally {
      await worker?.wire.close()
      await fixture.close()
    }
  })
}
