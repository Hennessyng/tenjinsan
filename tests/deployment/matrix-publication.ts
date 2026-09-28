import { createHash } from "node:crypto"
import { type APIResponse, expect } from "@playwright/test"
import { z } from "zod"
import type { MatrixDeployment } from "./matrix-driver.ts"
import { type MatrixCase, recordCase } from "./matrix-evidence.ts"
import { runRenewedPublication } from "./matrix-publication-renewal.ts"

type PublicationCase = {
  readonly deployment: MatrixDeployment
  readonly createSetup: (provider: "openai" | "anthropic") => Promise<string>
  readonly post: (path: string, data: object) => Promise<APIResponse>
}

async function until<T>(read: () => Promise<T | null>, label: string | (() => string)): Promise<T> {
  const deadline = Date.now() + 40_000
  while (Date.now() < deadline) {
    const value = await read()
    if (value !== null) return value
    await new Promise<void>((resolve) => setTimeout(resolve, 100))
  }
  throw new TypeError(
    `${typeof label === "string" ? label : label()} did not reach the expected state`,
  )
}

export async function runPublicationCases(input: PublicationCase): Promise<readonly MatrixCase[]> {
  const { deployment, post } = input
  const { page, origin } = deployment
  await deployment.fault("normal")
  const setupId = await input.createSetup("openai")
  let lastJobs: readonly {
    readonly stage: string
    readonly state: string
    readonly failureCode: string | null
  }[] = []
  const setup = await until(
    async () => {
      const snapshot = (await deployment.snapshot(setupId)).setup
      lastJobs =
        snapshot?.jobs.map((job) => ({
          stage: job.stage,
          state: job.state,
          failureCode: job.failureCode,
        })) ?? []
      const failure = snapshot?.jobs.find((job) => job.state === "failed" || job.state === "paused")
      if (failure)
        throw new TypeError(
          `Generated questions stopped at ${failure.stage}:${failure.state}:${failure.failureCode ?? failure.reason}`,
        )
      return snapshot?.interviewId ? snapshot : null
    },
    () => `generated questions (${JSON.stringify(lastJobs)})`,
  )
  const studyId = setup.studyId
  const saved = await post(`/api/briefs/${studyId}`, {
    action: "save",
    expectedRevisionId: "",
    originalEn: "How does attention shape listening?",
    originalJa: "注意は聴くことをどう変えますか？",
    refinedEn: "",
    refinedJa: "",
    supportEn0: "",
    supportJa0: "",
    supportEn1: "",
    supportJa1: "",
    supportEn2: "",
    supportJa2: "",
    purpose: "Read the synthetic source carefully",
    context: "Synthetic QA context",
    questionChoice: "original",
    depth: "focused",
    language: "paired",
    spoilerPolicy: "avoid",
    exclusions: "",
  })
  expect(saved.status()).toBe(200)
  const briefId = (await deployment.snapshot(setupId)).setup?.briefId
  if (!briefId) throw new TypeError("Missing draft brief")
  expect(
    (await post(`/api/briefs/${studyId}`, { action: "approve", revisionId: briefId })).status(),
  ).toBe(200)
  expect(
    (
      await post(`/api/outlines/${studyId}`, {
        action: "generate",
        briefRevisionId: briefId,
        expectedRevisionId: "",
      })
    ).status(),
  ).toBe(200)
  const outlineId = await until(
    async () => (await deployment.snapshot(setupId)).setup?.outlineId ?? null,
    "generated outline",
  )
  await deployment.fault("privacy-canary")
  expect(
    (await post(`/api/outlines/${studyId}`, { action: "approve", revisionId: outlineId })).status(),
  ).toBe(200)
  const lessonId = await until(
    async () => (await deployment.snapshot(setupId)).setup?.lessonId ?? null,
    "generated lesson",
  )
  const evidenceUrl = `/api/evidence/${studyId}/${lessonId}`
  const initial = await page.request.get(`${origin}${evidenceUrl}`)
  expect(initial.status()).toBe(200)
  const review = z
    .object({
      view: z.object({
        draft: z.object({ id: z.string(), manualFlags: z.array(z.unknown()) }),
        ready: z.boolean(),
      }),
      entries: z.array(z.object({ path: z.string(), text: z.string() })),
    })
    .parse(await initial.json())
  const canary = review.entries.find((entry) => entry.text.includes("TASK31_PRIVATE_CANARY"))
  if (!canary) throw new TypeError("Projected synthetic canary missing")
  const flagged = await post(evidenceUrl, {
    expectedId: review.view.draft.id,
    action: "privacy-flag",
    path: canary.path,
  })
  expect(flagged.status()).toBe(200)
  const flaggedView = z
    .object({
      view: z.object({
        draft: z.object({ id: z.string(), manualFlags: z.array(z.unknown()).min(1) }),
        ready: z.literal(false),
      }),
    })
    .parse(await flagged.json()).view
  const privacyDenied = await post(evidenceUrl, {
    expectedId: flaggedView.draft.id,
    action: "privacy-reviewed",
  })
  expect(privacyDenied.status()).toBe(409)
  const publishDenied = await post(`/api/publications/${studyId}`, {
    expectedId: flaggedView.draft.id,
    action: "publish",
  })
  expect(publishDenied.status()).toBe(409)
  const blocked = (await deployment.snapshot(setupId)).setup
  expect(blocked?.publications).toBe(0)
  expect(blocked?.outputs).toEqual([])
  await page.goto(`${origin}/evidence/${studyId}/${lessonId}`)
  await expect(page.getByRole("alert").filter({ hasText: canary.path }).first()).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Confirm privacy review of all projected content" }),
  ).toBeDisabled()
  const results: MatrixCase[] = [
    await recordCase(
      deployment,
      { name: "privacy-canary", http: publishDenied.status(), job: "blocked" },
      setupId,
    ),
  ]

  const corrected = await post(evidenceUrl, {
    expectedId: flaggedView.draft.id,
    action: "replace-text",
    path: canary.path,
    text: "A synthetic passage invites careful reading.",
  })
  expect(corrected.status()).toBe(200)
  for (const category of ["support", "qualification", "translation", "visual"] as const) {
    const latest = z
      .object({ view: z.object({ draft: z.object({ id: z.string() }) }) })
      .parse(await (await page.request.get(`${origin}${evidenceUrl}`)).json()).view.draft.id
    const marked = await post(evidenceUrl, {
      expectedId: latest,
      action: "semantic",
      category,
      status: "reviewed",
    })
    expect(marked.status()).toBe(200)
  }
  const reviewedId = z
    .object({ view: z.object({ draft: z.object({ id: z.string() }) }) })
    .parse(await (await page.request.get(`${origin}${evidenceUrl}`)).json()).view.draft.id
  expect(
    (await post(evidenceUrl, { expectedId: reviewedId, action: "privacy-reviewed" })).status(),
  ).toBe(200)
  const approvedId = z
    .object({ view: z.object({ draft: z.object({ id: z.string() }), ready: z.literal(true) }) })
    .parse(await (await page.request.get(`${origin}${evidenceUrl}`)).json()).view.draft.id
  await deployment.renderFailure(true)
  expect(
    (
      await post(`/api/publications/${studyId}`, { expectedId: approvedId, action: "publish" })
    ).status(),
  ).toBe(200)
  const publicationId = (await deployment.snapshot(setupId)).setup?.publicationId
  if (!publicationId) throw new TypeError("Approved publication missing")
  expect((await post(`/api/publications/${studyId}/outputs/${publicationId}`, {})).status()).toBe(
    200,
  )
  let lastOutputs: readonly {
    readonly format: string
    readonly state: string
    readonly error: string | null
  }[] = []
  const outputs = await until(async () => {
    const records = (await deployment.snapshot(setupId)).setup?.outputs
    lastOutputs =
      records?.map((output) => ({
        format: output.format,
        state: output.state,
        error: output.error,
      })) ?? []
    return records?.some((output) => output.format === "pdf" && output.state === "failed")
      ? records
      : null
  }, "renderer failure").catch((error: unknown) => {
    throw new TypeError(
      `Renderer output states ${lastOutputs.map((output) => `${output.format}:${output.state}:${output.error ?? "none"}`).join(",")}`,
      { cause: error },
    )
  })
  const pdf = outputs.find((output) => output.format === "pdf")
  if (!pdf) throw new TypeError("PDF output missing")
  expect(pdf.artifactHash).toBeNull()
  expect(pdf.error).toBe("render-error")
  const download = await page.request.get(`${origin}/publication-artifacts/${pdf.id}`)
  expect(download.status()).toBe(409)
  results.push(
    await recordCase(
      deployment,
      { name: "renderer-failure", http: download.status(), job: pdf.state },
      setupId,
    ),
  )
  const html = await until(async () => {
    const records = (await deployment.snapshot(setupId)).setup?.outputs
    return (
      records?.find((output) => output.format === "html" && output.state === "released") ?? null
    )
  }, "approved HTML")
  const htmlDownload = await page.request.get(`${origin}/publication-artifacts/${html.id}`)
  expect(htmlDownload.status()).toBe(200)
  const bytes = await htmlDownload.body()
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(html.artifactHash)
  expect(bytes.toString()).not.toContain("TASK31_PRIVATE_CANARY")
  results.push(
    await runRenewedPublication({
      deployment,
      post,
      setupId,
      studyId,
      evidenceUrl,
      approvedId,
      previousPublicationId: publicationId,
    }),
  )
  return results
}
