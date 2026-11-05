import { expect, test } from "@playwright/test"
import { uploadHarness } from "@reading-studio/server/upload-fixture"

for (const locale of ["en", "ja"] as const) {
  for (const width of [375, 768, 1280]) {
    test(`${locale} retired unknown job does not offer retry at ${width}`, async ({
      page,
    }, info) => {
      // Given
      const harness = await uploadHarness({ studioAssets: true })
      try {
        await page.setViewportSize({ width, height: 800 })
        await page.route("**/api/study-jobs", (route) =>
          route.fulfill({
            json: {
              providerCharges: "not-returned",
              jobs: [
                {
                  id: "synthetic-job",
                  studyId: "synthetic-study",
                  sourceRevisionId: "synthetic-source",
                  setupRevisionId: "synthetic-setup",
                  inputRevisionId: "synthetic-input",
                  stage: "analysis",
                  state: "paused",
                  reason: "outcome_unknown",
                  trace_id: null,
                  explanation: null,
                  checkpoint: false,
                  section: null,
                  cancellationRequested: false,
                  attempts: 1,
                  retryRemaining: 1,
                  callBudgetRemaining: 19,
                  callBudgetLimit: 20,
                  retired: true,
                  runBudgetRemaining: 1,
                  usage: { kind: "unknown" },
                  failureCode: null,
                  canRetry: false,
                  unknownAttemptId: "synthetic-attempt",
                  provider: "openrouter",
                  model: "synthetic-model",
                },
              ],
            },
          }),
        )
        // When
        await page.goto(`${harness.origin}/jobs?lang=${locale}&setup=synthetic-setup`)
        await expect(page.getByText("synthetic-job")).toBeVisible()
        await page
          .getByRole("button", { name: locale === "en" ? "Confirm stop" : "停止を確定" })
          .scrollIntoViewIfNeeded()
        // Then
        await expect(
          page.getByRole("button", { name: locale === "en" ? "Approve retry" : "再試行を承認" }),
        ).toHaveCount(0)
        await page.screenshot({ path: info.outputPath("retired-job.png") })
      } finally {
        await harness.close()
      }
    })
  }
}
