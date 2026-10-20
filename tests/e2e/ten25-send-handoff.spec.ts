import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { expect, test } from "@playwright/test"
import { analysisCacheKey, InputCoverage } from "@reading-studio/contracts"
import { epubEntries, zipFixture } from "@reading-studio/ingestion/test-support"
import { uploadHarness } from "@reading-studio/server/upload-fixture"
import { z } from "zod"

const evidence = ".omo/evidence/TEN-25"
for (const width of [375, 768, 1280]) {
  test(`partial EPUB Send recovers a lost response and opens persisted questions at ${width}px`, async ({
    page,
  }) => {
    // Given
    const directory = await mkdtemp(join(tmpdir(), "ten25-browser-"))
    const control = join(directory, "control")
    await mkdir(control)
    await mkdir(evidence, { recursive: true })
    const binary = join(directory, "synthetic-tool")
    await writeFile(
      binary,
      `#!/bin/sh\nexec "${process.execPath}" "${resolve("apps/worker/tests/question-handoff-fixture.cjs")}" kind:codex scenario:strict-schema "control:${control}" "$@"\n`,
      { mode: 0o700 },
    )
    const env = { ...process.env }
    Object.assign(process.env, {
      STUDIO_SUBSCRIPTION_CODEX_BINARY: binary,
      OPENROUTER_API_KEY: "",
      ANTHROPIC_API_KEY: "",
    })
    const harness = await uploadHarness({
      studioAssets: true,
      providerAvailable: true,
      queueAnalysis: true,
      localSubscriptions: true,
    })
    Object.assign(process.env, {
      DATABASE_PATH: join(harness.directory, "auth.sqlite"),
      PRIVATE_DATA_ROOT: harness.root,
      SERVER_HOST: "127.0.0.1",
      TRUST_PROXY: "0",
      TRUSTED_ORIGINS: harness.origin,
    })
    const external: string[] = []
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.name))
    await page.route("**/*", (route) => {
      if (new URL(route.request().url()).origin === harness.origin) return route.continue()
      external.push(new URL(route.request().url()).hostname)
      return route.abort()
    })
    let worker: ChildProcess | undefined
    let exited: Promise<unknown> | undefined
    try {
      await page.setViewportSize({ width, height: 900 })
      await page.goto(`${harness.origin}/imports?lang=en`)
      const bytes = zipFixture(
        epubEntries.map((entry) =>
          entry.name.endsWith("chapter.xhtml")
            ? {
                ...entry,
                text: entry.text.replace(
                  "</body>",
                  "<script>WITHHELD_FIXTURE_PASSAGE</script></body>",
                ),
              }
            : entry,
        ),
      )
      await page
        .getByLabel(/Choose EPUB/)
        .setInputFiles({ name: "synthetic.epub", mimeType: "application/epub+zip", buffer: bytes })
      await page.getByRole("button", { name: "Import document", exact: true }).click()
      await page.getByRole("link", { name: "Read this book", exact: true }).click()
      await page.getByRole("link", { name: "Set up a study", exact: true }).click()
      await page.getByRole("button", { name: "Connect ChatGPT", exact: true }).click()
      const providers = page.getByRole("combobox", { name: "Provider and model" })
      await expect(providers).toContainText("chatgpt-subscription / Study model")
      await providers.selectOption({ label: "chatgpt-subscription / Study model" })
      await page.getByRole("button", { name: "Review transmission", exact: true }).click()
      await expect(
        page.getByRole("heading", { name: "Review transmission", exact: true }),
      ).toBeVisible()
      await expect(page.getByText(/Original-file attachment unavailable/)).toBeVisible()
      const setupId = new URL(page.url()).pathname.split("/").at(-1)
      const setup = harness.sourceStorage.sources.getSetup(setupId)
      if (!setup) throw new TypeError("Synthetic setup missing")
      expect(
        harness.sourceStorage.sources.getNormalization(setup.analysis.normalizationRevisionId)
          ?.coverage,
      ).toBe("partial")
      const reviewUrl = page.url()
      await page.screenshot({ path: `${evidence}/review-${width}.png`, fullPage: true })
      let release: () => void = () => {
        throw new TypeError("Pending request missing")
      }
      const held = new Promise<void>((resolve) => {
        release = resolve
      })
      let sends = 0
      await page.route("**/api/study-setup/**", async (route) => {
        if (route.request().method() !== "POST") return route.continue()
        sends += 1
        await held
        await route.fetch()
        return route.abort("failed")
      })
      // When
      await page.getByRole("button", { name: "Send", exact: true }).click()
      await expect(page.getByRole("status")).toContainText("Saving your consent")
      await expect(
        page.getByRole("button", { name: "Saving consent…", exact: true }),
      ).toBeDisabled()
      await page.screenshot({ path: `${evidence}/pending-${width}.png`, fullPage: true })
      release()
      await expect(
        page.getByRole("heading", { name: "Transmission approved", exact: true }),
      ).toBeVisible()
      await page.screenshot({ path: `${evidence}/accepted-${width}.png`, fullPage: true })
      worker = spawn(
        process.execPath,
        ["--experimental-transform-types", resolve("apps/worker/src/index.ts")],
        {
          env: { ...process.env, STUDIO_SYNTHETIC_TEST_MODE: "" },
          stdio: ["ignore", "pipe", "pipe"],
        },
      )
      const output: string[] = []
      worker.stdout?.on("data", (chunk: Buffer) => output.push(chunk.toString()))
      worker.stderr?.on("data", (chunk: Buffer) => output.push(chunk.toString()))
      exited = once(worker, "exit")
      await expect
        .poll(() => harness.sourceStorage.interviews.latest(setup.studyId)?.steps.length, {
          timeout: 15000,
        })
        .toBe(1)
      worker.kill("SIGTERM")
      await exited
      await writeFile(`${evidence}/worker-${width}.log`, output.join(""))
      const inspections = await readFile(join(control, "prompt-inspections.jsonl"), "utf8")
      const checks = inspections
        .trim()
        .split("\n")
        .map((line) =>
          z
            .object({
              stage: z.enum(["analysis", "questions"]),
              excludedSentinelPresent: z.boolean(),
            })
            .parse(JSON.parse(line)),
        )
      expect(checks.some((check) => check.stage === "analysis")).toBe(true)
      expect(checks.some((check) => check.stage === "questions")).toBe(true)
      expect(checks.every((check) => !check.excludedSentinelPresent)).toBe(true)
      await writeFile(`${evidence}/provider-prompt-inspections-${width}.jsonl`, inspections)
      await page.goto(reviewUrl)
      // Then
      await expect(page.locator('[data-analysis-progress="questions-ready"]')).toBeVisible()
      await page.screenshot({ path: `${evidence}/saved-${width}.png`, fullPage: true })
      await page.getByRole("link", { name: "Open saved questions", exact: true }).click()
      await expect(page.getByRole("radio").first()).toBeVisible()
      await page.getByRole("radio").first().check()
      const submit = page.getByRole("button", { name: "Save choices", exact: true })
      await submit.click()
      await page.reload()
      await expect(page.getByRole("radio").first()).toBeChecked()
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true)
      await page.screenshot({ path: `${evidence}/questions-reloaded-${width}.png`, fullPage: true })
      await page.getByRole("radio").first().scrollIntoViewIfNeeded()
      await page.screenshot({ path: `${evidence}/questions-options-${width}.png`, fullPage: true })
      const analysis = harness.sourceStorage.workflow.findSuccessfulAnalysis(
        analysisCacheKey(setup.analysis),
      )
      expect(analysis?.status).toBe("successful")
      const jobs = harness.sourceStorage.execution.listSetupJobs(setup.id)
      expect(jobs.every((job) => job.state === "completed")).toBe(true)
      expect(jobs.filter((job) => job.stage === "questions")).toHaveLength(1)
      expect(sends).toBe(1)
      expect(external).toEqual([])
      expect(errors).toEqual([])
      const ledger = await page.request.get(`${harness.origin}/api/study-jobs`)
      expect(ledger.status()).toBe(200)
      const projection = z
        .object({
          jobs: z.array(z.object({ stage: z.string(), inputCoverage: z.array(InputCoverage) })),
        })
        .parse(await ledger.json())
      expect(projection.jobs.length).toBeGreaterThan(0)
      const coverage = projection.jobs
        .filter((job) => job.stage === "analysis")
        .flatMap((job) => job.inputCoverage)
      const normalization = harness.sourceStorage.sources.getNormalization(
        setup.analysis.normalizationRevisionId,
      )
      if (!normalization) throw new TypeError("Synthetic normalization missing")
      const reviewed = normalization.resources
        .flatMap((resource) =>
          resource.status === "included"
            ? resource.blocks
                .filter((block) => block.text.length > 0)
                .map((block) => JSON.stringify([resource.path, block.id, 0, block.text.length]))
            : [],
        )
        .sort()
      expect(
        coverage
          .flatMap((item) =>
            item.ranges.map((range) =>
              JSON.stringify([range.resourcePath, range.blockId, range.start, range.end]),
            ),
          )
          .sort(),
      ).toEqual(reviewed)
      expect(
        coverage.every((item) => item.extraction === "partial" && item.omissions.length > 0),
      ).toBe(true)
      expect(JSON.stringify(projection)).not.toContain("WITHHELD_FIXTURE_PASSAGE")
      expect(JSON.stringify(projection)).not.toContain("Archive safety fixture.")
    } finally {
      if (worker?.exitCode === null && worker.signalCode === null) worker.kill("SIGTERM")
      await exited
      await page.context().close()
      await harness.close()
      for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key]
      Object.assign(process.env, env)
      await rm(directory, { recursive: true, force: true })
    }
  })
}

import { type ChildProcess, spawn } from "node:child_process"
import { once } from "node:events"
