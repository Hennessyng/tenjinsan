import { mkdir } from "node:fs/promises"
import { expect, test } from "@playwright/test"
import { analysisCacheKey } from "@reading-studio/contracts"
import { uploadHarness } from "@reading-studio/server/upload-fixture"
import { z } from "zod"

for (const width of [375, 768, 1280]) {
  test(`blocked stages stay read-only and provider refusal offers review at ${width}px`, async ({
    page,
    request,
  }) => {
    // Given
    const options = { studioAssets: true, providerAvailable: true }
    const fixture = await uploadHarness(options)
    const evidence = ".sisyphus/runs/TEN-23/review-screenshots"
    await mkdir(evidence, { recursive: true })
    await page.route("**/*", (route) =>
      new URL(route.request().url()).origin === fixture.origin ? route.continue() : route.abort(),
    )
    try {
      const imported = await request.post(`${fixture.origin}/api/imports/upload`, {
        headers: { origin: fixture.origin, "content-type": "text/plain" },
        data: "Synthetic book for blocked-stage review.",
      })
      expect(imported.status()).toBe(202)
      const { normalizationRevisionId: revision } = z
        .object({ normalizationRevisionId: z.string() })
        .parse(await imported.json())
      const normalization = fixture.sourceStorage.sources.getNormalization(revision)
      if (!normalization) throw new TypeError("Missing fixture normalization")
      const study = fixture.sourceStorage.sources.listStudiesByEdition(normalization.editionId)[0]
      if (!study) throw new TypeError("Missing fixture study")
      const draft = await request.post(`${fixture.origin}/api/study-setup/${revision}`, {
        headers: { origin: fixture.origin },
        data: { provider: "anthropic", scope: "whole-document" },
      })
      expect(draft.status()).toBe(201)
      const { setupId } = z.object({ setupId: z.string() }).parse(await draft.json())
      await page.setViewportSize({ width, height: 900 })
      await page.goto(`${fixture.origin}/sources/${revision}/setup/${setupId}?lang=en`)
      await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled()
      options.providerAvailable = false
      // When
      await page.getByRole("button", { name: "Send", exact: true }).click()
      // Then
      await expect(page.getByRole("alert")).toContainText("selected provider is unavailable")
      await expect(
        page.getByRole("link", { name: "Check connections and review a new setup" }),
      ).toHaveAttribute("href", `/sources/${revision}/setup?lang=en`)
      await page.screenshot({ path: `${evidence}/${width}-provider-refusal.png`, fullPage: true })
      expect(fixture.sourceStorage.counts()).toMatchObject({ grants: 0, jobs: 0, attempts: 0 })
      options.providerAvailable = true
      const sent = await request.post(`${fixture.origin}/api/study-setup/${revision}/${setupId}`, {
        headers: { origin: fixture.origin },
        data: { decision: "send" },
      })
      expect(sent.status()).toBe(200)
      const storage = fixture.sourceStorage
      const setup = storage.sources.getSetup(setupId)
      const grant = storage.sources.getGrant(`grant-${setupId}`)
      if (!setup || !grant) throw new TypeError("Missing fixture setup/grant")
      const inputRevisionId = storage.workflow.ensureAnalysisInput(setupId)
      const cases = [
        { stage: "analysis", state: "failed", error: { code: "input-limit", retryable: false } },
        { stage: "questions", state: "paused", reason: "budget-exhausted" },
      ] as const
      for (const [index, variant] of cases.entries()) {
        if (variant.stage === "questions")
          storage.workflow.appendAnalysis({
            parentRevisionId: null,
            record: {
              id: "analysis-status-fixture",
              editionId: setup.editionId,
              cacheInput: setup.analysis,
              cacheKey: analysisCacheKey(setup.analysis),
              status: "successful",
              chapters: setup.analysis.scope.selected.map((selection) => ({
                ...selection,
                status: "complete",
              })),
              claims: [],
              concepts: [],
              qualifications: [],
            },
          })
        const id = `blocked-${index}`
        storage.execution.appendRun({
          id,
          inputRevisionId,
          budget: { maxCalls: 2 },
          reservedCalls: 0,
          state: "running",
        })
        storage.execution.appendJob({
          id,
          runId: id,
          inputRevisionId,
          setupRevisionId: setupId,
          provider: setup.analysis.provider,
          model: setup.analysis.model,
          promptVersion: "generation-1",
          schemaVersion: "generation-1",
          grant,
          checkpoint: null,
          cancellationRequested: false,
          usage: { kind: "known", inputTokens: 0, outputTokens: 0 },
          ...variant,
        })
        const before = storage.execution.listSetupJobs(setupId)
        const counts = storage.counts()
        for (const locale of ["en", "ja"]) {
          await page.goto(`${fixture.origin}/interviews/${study.id}?lang=${locale}`)
          await expect(page.getByRole("heading", { level: 1 })).toHaveText(
            variant.stage === "analysis"
              ? locale === "en"
                ? "Source analysis"
                : "資料の分析"
              : locale === "en"
                ? "Question generation"
                : "質問の作成",
          )
          await expect(page.locator("main code")).toHaveText(
            variant.state === "failed" ? "input-limit" : "budget-exhausted",
          )
          const link = page.getByRole("link", {
            name: locale === "en" ? "View progress and next actions" : "進捗と必要な操作を見る",
          })
          await page.screenshot({
            path: `${evidence}/${width}-${locale}-${variant.stage}-${variant.state}-top.png`,
            fullPage: true,
          })
          await link.focus()
          await page.screenshot({
            path: `${evidence}/${width}-${locale}-${variant.stage}-${variant.state}.png`,
            fullPage: true,
          })
          await link.click()
          await expect(page).toHaveURL(new RegExp(`/jobs\\?setup=${setupId}&lang=${locale}`))
          await page.reload()
        }
        expect(storage.execution.listSetupJobs(setupId)).toEqual(before)
        expect(storage.counts()).toEqual(counts)
      }
      await page.route("**/api/interview-readiness/*", (route) =>
        route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "fixture-unavailable" }),
        }),
      )
      await page.goto(`${fixture.origin}/interviews/${study.id}?lang=en`)
      await expect(
        page.getByRole("heading", { name: "Could not check interview status" }),
      ).toBeVisible()
      await page.screenshot({
        path: `${evidence}/${width}-status-retrieval-failure.png`,
        fullPage: true,
      })
      expect(storage.counts().attempts).toBe(0)
    } finally {
      await fixture.close()
    }
  })
}
