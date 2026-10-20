import { afterEach, expect, it } from "vitest"
import { z } from "zod"
import { uploadHarness } from "./testing/upload-harness.ts"

const harnesses: Awaited<ReturnType<typeof uploadHarness>>[] = []
afterEach(async () => {
  for (const harness of harnesses.splice(0)) await harness.close()
})

async function imported() {
  const harness = await uploadHarness({ providerAvailable: true })
  harnesses.push(harness)
  const response = await fetch(`${harness.origin}/api/imports/upload`, {
    method: "POST",
    headers: { origin: harness.origin, "content-type": "text/plain" },
    body: "A synthetic book about asking careful questions.",
  })
  expect(response.status).toBe(202)
  const { normalizationRevisionId: revision } = z
    .object({ normalizationRevisionId: z.string() })
    .parse(await response.json())
  const normalization = harness.sourceStorage.sources.getNormalization(revision)
  if (!normalization) throw new TypeError("Missing imported normalization")
  const study = harness.sourceStorage.sources.listStudiesByEdition(normalization.editionId)[0]
  if (!study) throw new TypeError("Missing imported study")
  const headers = { origin: harness.origin, "content-type": "application/json" }
  const status = () => fetch(`${harness.origin}/api/interview-readiness/${study.id}`)
  const draft = async () => {
    const response = await fetch(`${harness.origin}/api/study-setup/${revision}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ provider: "anthropic", scope: "whole-document" }),
    })
    expect(response.status).toBe(201)
    return z.object({ setupId: z.string() }).parse(await response.json()).setupId
  }
  return { harness, revision, study, headers, status, draft }
}

it("points an imported study without setup to its own setup without starting work", async () => {
  // Given
  const { harness, revision, status } = await imported()
  const before = harness.sourceStorage.counts()
  // When
  const responses = await Promise.all([status(), status()])
  // Then
  for (const response of responses) {
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(await response.json()).toMatchObject({
      kind: "setup-required",
      actionHref: `/sources/${revision}/setup`,
    })
  }
  expect(harness.sourceStorage.counts()).toEqual(before)
})

it("points an unapproved setup to review rather than claiming generation is running", async () => {
  // Given
  const { harness, revision, status, draft } = await imported()
  const setupId = await draft()
  const before = harness.sourceStorage.counts()
  // When
  const response = await status()
  // Then
  expect(await response.json()).toMatchObject({
    kind: "review-required",
    actionHref: `/sources/${revision}/setup/${setupId}`,
  })
  expect(harness.sourceStorage.counts()).toEqual(before)
})

const variants = [
  { state: "queued" },
  {
    state: "running",
    lease: {
      token: "fixture",
      fence: 1,
      heartbeatAt: "2026-01-01T00:00:00Z",
      expiresAt: "2026-01-01T00:01:00Z",
    },
  },
  { state: "failed", error: { code: "private raw error must not escape", retryable: false } },
  { state: "paused", reason: "outcome_unknown" },
  { state: "paused", reason: "budget-exhausted" },
  { state: "cancelled" },
] as const
it.each(
  (["analysis", "questions"] as const).flatMap((stage) =>
    variants.map((variant, index) => ({ stage, variant, index })),
  ),
)(
  "reports actual $stage $variant.state work without mutating jobs",
  async ({ stage, variant, index }) => {
    // Given
    const { harness, revision, headers, status, draft } = await imported()
    const setupId = await draft()
    const sent = await fetch(`${harness.origin}/api/study-setup/${revision}/${setupId}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ decision: "send" }),
    })
    expect(sent.status).toBe(200)
    const storage = harness.sourceStorage
    const grant = storage.sources.getGrant(`grant-${setupId}`)
    const setup = storage.sources.getSetup(setupId)
    if (!grant || !setup) throw new TypeError("Missing approved fixture setup")
    const inputRevisionId = storage.workflow.ensureAnalysisInput(setupId)
    const runId = `run-${index}`
    storage.execution.appendRun({
      id: runId,
      inputRevisionId,
      budget: { maxCalls: 2 },
      reservedCalls: 0,
      state: "running",
    })
    storage.execution.appendJob({
      id: `job-${index}`,
      runId,
      inputRevisionId,
      setupRevisionId: setupId,
      provider: setup.analysis.provider,
      model: setup.analysis.model,
      promptVersion: "generation-1",
      schemaVersion: "generation-1",
      grant,
      stage,
      checkpoint: null,
      cancellationRequested: false,
      usage: { kind: "known", inputTokens: 0, outputTokens: 0 },
      ...variant,
    })
    const before = storage.counts()
    const jobsBefore = storage.execution.listSetupJobs(setupId)
    // When
    const response = await status()
    const body: unknown = await response.json()
    // Then
    expect(body).toMatchObject({
      kind: "progress",
      stage,
      state: variant.state,
      actionHref: `/jobs?setup=${setupId}`,
    })
    expect(JSON.stringify(body)).not.toContain("private raw error")
    expect(storage.counts()).toEqual(before)
    expect(storage.execution.listSetupJobs(setupId)).toEqual(jobsBefore)
  },
)

it("distinguishes a missing study from an imported study", async () => {
  // Given
  const { harness } = await imported()
  // When
  const response = await fetch(`${harness.origin}/api/interview-readiness/missing-study`)
  // Then
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ kind: "missing-study" })
})
