import { randomUUID } from "node:crypto"
import { mkdir } from "node:fs/promises"
import { expect, test } from "@playwright/test"
import { sourceViewerFixture } from "@reading-studio/server/source-viewer-fixture"

const evidence = `.omo/evidence/reading-studio/f1-f2-owner-jobs-followup/runs/${randomUUID()}`
const defaultSettings = {
  temperature: 0,
  topP: 1,
  seed: null,
  reasoningEffort: "default",
  maxOutputTokens: 6000,
} as const

test("owner sees current job, checkpoint and usage, then cancels from keyboard at mobile, tablet and desktop", async ({
  page,
}) => {
  // Given: an authenticated study with a queued analysis job in real SQLite.
  const fixture = await sourceViewerFixture({ studioAssets: true })
  try {
    const storage = fixture.storage
    const owner = storage.sources.listStudiesByEdition("edition-fixture")[0]
    if (!owner) throw new TypeError("Fixture study missing")
    const installationId = storage.sources.createInstallation({
      id: "installation-browser-jobs",
      ownerId: owner.ownerId,
    })
    storage.sources.appendSetup({
      parentRevisionId: null,
      record: {
        id: "setup-browser-jobs",
        studyId: owner.id,
        editionId: owner.editionId,
        analysis: {
          editionHash: "a".repeat(64),
          normalizationRevisionId: "revision-fixture",
          scope: {
            kind: "partial",
            selected: [{ resourcePath: "chapter-one.xhtml", blockIds: ["opening"] }],
            exclusions: [],
          },
          provider: "openai",
          model: "gpt-4.1-mini",
          analysisPromptVersion: "analysis-1",
          analysisSchemaVersion: "analysis-1",
          settings: defaultSettings,
        },
        generation: {
          promptVersion: "generation-1",
          schemaVersion: "generation-1",
          settings: defaultSettings,
        },
      },
    })
    const grant = storage.sources.appendGrant({
      id: "grant-setup-browser-jobs",
      kind: "active",
      setupRevisionId: "setup-browser-jobs",
      installationId,
      ownerId: owner.ownerId,
      categories: ["book-text"],
      approvedAt: new Date().toISOString(),
    })
    const inputRevisionId = storage.workflow.ensureAnalysisInput("setup-browser-jobs")
    storage.execution.appendRun({
      id: "run-browser-jobs",
      inputRevisionId,
      budget: {
        maxCalls: 2,
        maxSourceCharacters: 32000,
        maxOutputTokens: 6000,
        maxTransientRetries: 2,
        maxSchemaRepairs: 1,
      },
      reservedCalls: 0,
      state: "running",
    })
    storage.execution.appendJob({
      id: "job-browser-jobs",
      runId: "run-browser-jobs",
      inputRevisionId,
      setupRevisionId: "setup-browser-jobs",
      provider: "openai",
      model: "gpt-4.1-mini",
      promptVersion: "analysis-1",
      schemaVersion: "analysis-1",
      grant,
      stage: "analysis",
      checkpoint: null,
      cancellationRequested: false,
      usage: { kind: "known", inputTokens: 0, outputTokens: 0 },
      state: "queued",
    })
    await mkdir(evidence, { recursive: true })
    await page.goto(`${fixture.origin}/login`)
    await page.getByLabel("Email").fill(fixture.credentials.email)
    await page.getByLabel("Password").fill(fixture.credentials.password)
    await page.getByRole("button", { name: "Log in" }).click()
    for (const width of [375, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto(`${fixture.origin}/jobs`)
      // When: the job ledger loads at each width.
      await expect(page.getByRole("heading", { name: /Study progress/ })).toBeVisible()
      await expect(page.getByText("Unknown tokens / トークン数不明")).toHaveCount(0)
      await expect(page.getByText(/Calls remaining in setup/)).toContainText("64 of 64")
      await expect(page.getByRole("link", { name: "Source / 資料" })).toHaveAttribute(
        "href",
        "/sources/revision-fixture",
      )
      await expect(page.getByRole("link", { name: "New setup / 新しい設定" })).toHaveAttribute(
        "href",
        "/sources/revision-fixture/setup",
      )
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
      await page.screenshot({ path: `${evidence}/queued-${width}.png`, fullPage: true })
    }
    // Then: keyboard cancellation updates the visible job and persisted record.
    const cancel = page.getByRole("button", { name: /Cancel work/ })
    await cancel.focus()
    expect(await cancel.evaluate((element) => getComputedStyle(element).outlineWidth)).toBe("3px")
    await page.keyboard.press("Enter")
    await expect(page.getByRole("heading", { name: /analysis · cancelled/ })).toBeVisible()
    expect(storage.execution.getJob("job-browser-jobs")?.state).toBe("cancelled")
    await page.screenshot({ path: `${evidence}/cancelled-1280.png`, fullPage: true })
    await page.getByRole("link", { name: "New setup / 新しい設定" }).click()
    await expect(page.getByRole("heading", { name: "Set up a study" })).toBeVisible()
    storage.execution.appendRun({
      id: "run-unknown-browser",
      inputRevisionId,
      budget: {
        maxCalls: 2,
        maxSourceCharacters: 32000,
        maxOutputTokens: 6000,
        maxTransientRetries: 2,
        maxSchemaRepairs: 1,
      },
      reservedCalls: 0,
      state: "running",
    })
    storage.execution.appendJob({
      id: "job-unknown-browser",
      runId: "run-unknown-browser",
      inputRevisionId,
      setupRevisionId: "setup-browser-jobs",
      provider: "openai",
      model: "gpt-4.1-mini",
      promptVersion: "analysis-1",
      schemaVersion: "analysis-1",
      grant,
      stage: "analysis",
      checkpoint: null,
      cancellationRequested: false,
      usage: { kind: "known", inputTokens: 0, outputTokens: 0 },
      state: "queued",
    })
    const claim = storage.execution.claimNextJob({
      token: "lease-unknown-browser",
      now: "2026-01-01T00:00:00.000Z",
      expiresAt: "2026-01-01T00:01:00.000Z",
    })
    if (claim?.state !== "running") throw new TypeError("Unknown fixture not claimed")
    const lease = {
      jobId: claim.id,
      token: claim.lease.token,
      fence: claim.lease.fence,
      now: "2026-01-01T00:00:01.000Z",
    }
    storage.execution.reserveAttempt({
      ...lease,
      attemptId: "attempt-unknown-browser",
      preparedAt: lease.now,
    })
    storage.execution.markAttemptDispatching({
      ...lease,
      attemptId: "attempt-unknown-browser",
      dispatchedAt: lease.now,
    })
    storage.execution.pauseUnknownProviderJob(lease)
    for (const width of [375, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto(`${fixture.origin}/jobs`)
      await expect(page.getByText("Unknown tokens / トークン数不明")).toBeVisible()
      await expect(page.getByRole("heading", { name: /Outcome unknown/ })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
      await page.screenshot({ path: `${evidence}/unknown-${width}.png`, fullPage: true })
    }
    const confirmation = page.locator(".job-check").first()
    const box = await confirmation.locator("input").boundingBox()
    const text = await confirmation.locator(":scope > span").boundingBox()
    expect(box && text && Math.abs(box.y - text.y)).toBeLessThan(8)
    const stop = page.getByRole("button", { name: /Confirm stop/ })
    await page
      .getByLabel(/Reason for this decision/)
      .first()
      .fill("Accepted call could have charged me")
    await page.getByLabel(/I understand stopping/).check()
    await stop.focus()
    await page.keyboard.press("Enter")
    await expect(page.getByRole("heading", { name: /analysis · cancelled/ })).toHaveCount(2)
    expect(storage.execution.getAttempt("attempt-unknown-browser")).toMatchObject({
      resolution: "stop-approved",
      usage: { kind: "unknown" },
    })
    await page.screenshot({ path: `${evidence}/unknown-stopped-1280.png`, fullPage: true })
  } finally {
    await fixture.close()
  }
})
