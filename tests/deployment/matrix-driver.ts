import { createHash } from "node:crypto"
import { expect, type Page } from "@playwright/test"
import { epubEntries, zipFixture } from "@reading-studio/ingestion/test-support"
import { z } from "zod"
import { type MatrixCase, recordCase } from "./matrix-evidence.ts"
import { runProviderFailureCase, until } from "./matrix-provider-failures.ts"
import { runPublicationCases } from "./matrix-publication.ts"
import { type RestoreReceipt, type RestoreTargets, runRestoreCase } from "./matrix-restore.ts"
import type { MatrixSnapshot } from "./matrix-snapshot.ts"
import { runAcceptedCrashCase, runCancelledStaleCase } from "./matrix-worker-cases.ts"

export type MatrixFault =
  | "normal"
  | "malformed-output"
  | "invalid-citation"
  | "hold"
  | "privacy-canary"
export type MatrixDeployment = {
  readonly origin: string
  readonly page: Page
  readonly snapshot: (setupId?: string) => Promise<z.infer<typeof MatrixSnapshot>>
  readonly fault: (fault: MatrixFault) => Promise<void>
  readonly renderFailure: (enabled: boolean) => Promise<void>
  readonly transfer: (targets: RestoreTargets) => Promise<RestoreReceipt>
  readonly wireCount: () => Promise<number>
  readonly heldCount: () => Promise<number>
  readonly restartWorker: (setupId: string, jobId: string) => Promise<void>
  readonly releaseHeld: () => Promise<void>
  readonly rememberLease: (jobId: string) => Promise<void>
  readonly rejectStaleCommit: (
    jobId: string,
    lease: {
      readonly token: string
      readonly fence: number
    },
  ) => Promise<boolean>
}

export async function runMatrix(deployment: MatrixDeployment): Promise<readonly MatrixCase[]> {
  const { page, origin } = deployment
  const results: MatrixCase[] = []
  await page.goto(`${origin}/login`)
  await page.getByLabel("Email").fill("owner@example.test")
  await page.getByLabel("Password").fill("correct horse battery staple")
  await page.getByRole("button", { name: "Log in" }).click()
  await expect(page.locator("#root")).toBeVisible()
  const post = (path: string, data: object) =>
    page.request.post(`${origin}${path}`, { data, headers: { origin }, failOnStatusCode: false })
  const before = await deployment.snapshot()
  const corrupt = await page.request.post(`${origin}/api/imports/upload`, {
    data: Buffer.from("not an EPUB"),
    headers: { origin, "content-type": "application/epub+zip" },
  })
  expect(corrupt.status()).toBe(422)
  expect((await deployment.snapshot()).counts).toEqual(before.counts)
  results.push(await recordCase(deployment, { name: "corrupt-epub", http: corrupt.status() }))

  const expired = await page.request.post(`${origin}/api/study-setup/absent`, {
    data: { provider: "openrouter", model: "gpt-4.1-mini", scope: "all-main-chapters" },
    headers: { origin, cookie: "better-auth.session_token=expired" },
  })
  expect(expired.status()).toBe(401)
  const expiredLedger = await page.request.get(`${origin}/api/study-jobs`, {
    headers: { cookie: "better-auth.session_token=expired" },
  })
  expect(expiredLedger.status()).toBe(401)
  expect((await deployment.snapshot()).counts).toEqual(before.counts)
  results.push(await recordCase(deployment, { name: "expired-session", http: expired.status() }))

  const uploadSource = async (variant: string) => {
    const entries = epubEntries.map((entry) =>
      entry.name === "book/chapter.xhtml"
        ? {
            ...entry,
            text: entry.text.replace(
              "Archive safety fixture.",
              `Archive safety fixture ${variant}.`,
            ),
          }
        : entry,
    )
    const upload = await page.request.post(`${origin}/api/imports/upload`, {
      data: zipFixture(entries),
      headers: { origin, "content-type": "application/epub+zip" },
    })
    expect(upload.status()).toBe(202)
    const receipt = z.object({ sha256: z.string().length(64) }).parse(await upload.json())
    return `normalization-${createHash("sha256")
      .update(JSON.stringify([receipt.sha256, "epub-parser-1", "epub-normalizer-1"]))
      .digest("hex")}`
  }
  let revision = await uploadSource("original")
  const createSetup = async (provider: "openrouter" | "anthropic") => {
    const created = await post(`/api/study-setup/${revision}`, {
      provider,
      model: provider === "openrouter" ? "gpt-4.1-mini" : "claude-sonnet-4-6",
      scope: "all-main-chapters",
    })
    expect(created.status()).toBe(201)
    const setupId = z.object({ setupId: z.string() }).parse(await created.json()).setupId
    const count = await deployment.wireCount()
    const granted = await post(`/api/study-setup/${revision}/${setupId}`, { decision: "send" })
    expect(granted.status()).toBe(200)
    expect(await deployment.wireCount()).toBeGreaterThanOrEqual(count)
    return setupId
  }
  results.push(await runProviderFailureCase(deployment, createSetup, "malformed-output"))
  results.push(await runProviderFailureCase(deployment, createSetup, "invalid-citation"))

  await deployment.fault("normal")
  const firstSetupId = await createSetup("openrouter")
  const firstAnalysis = await until(async () => {
    const current = (await deployment.snapshot(firstSetupId)).setup
    return current?.analysisId ? current : null
  }, "first provider analysis")
  const firstCalls = await deployment.wireCount()
  const secondSetupId = await createSetup("anthropic")
  const secondAnalysis = await until(async () => {
    const current = (await deployment.snapshot(secondSetupId)).setup
    return current?.analysisId ? current : null
  }, "changed provider analysis")
  expect(secondAnalysis.provider).toBe("anthropic")
  expect(secondAnalysis.cacheKey).not.toBe(firstAnalysis.cacheKey)
  expect(secondAnalysis.analysisId).not.toBe(firstAnalysis.analysisId)
  expect(secondAnalysis.analysisMarker).toBe("Anthropic synthetic fixture finding")
  expect(secondAnalysis.jobs.filter((job) => job.stage === "analysis")).not.toHaveLength(0)
  expect(
    secondAnalysis.jobs.every(
      (job) => job.grantId === `grant-${secondSetupId}` && job.provider === "anthropic",
    ),
  ).toBe(true)
  expect(await deployment.wireCount()).toBeGreaterThan(firstCalls)
  await until(async () => {
    const setup = (await deployment.snapshot(secondSetupId)).setup
    return setup?.interviewId &&
      setup.jobs.length >= 2 &&
      setup.jobs.every((job) => job.state === "completed")
      ? setup
      : null
  }, "provider questions drained")
  results.push(
    await recordCase(
      deployment,
      { name: "cross-provider", http: 200, job: "completed" },
      secondSetupId,
    ),
  )

  revision = await uploadSource("privacy")
  const publicationCases = await runPublicationCases({ deployment, createSetup, post })
  results.push(...publicationCases)
  const published = publicationCases.at(-1)?.lineage.setup
  const released = published?.outputs.find((output) => output.format === "html")
  if (!published?.publicationId || !released)
    throw new TypeError("Released publication required for restore")
  results.push(
    await runRestoreCase(deployment, {
      studyId: published.studyId,
      publicationId: published.publicationId,
      outputId: released.id,
    }),
  )
  revision = await uploadSource("crash")
  results.push(await runAcceptedCrashCase(deployment, createSetup, post))
  revision = await uploadSource("stale")
  results.push(await runCancelledStaleCase(deployment, createSetup, post))
  return results
}
