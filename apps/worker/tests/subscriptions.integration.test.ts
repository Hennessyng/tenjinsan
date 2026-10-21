import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SubscriptionProvider } from "@reading-studio/contracts"
import { ProviderAdapter, ProviderRunner } from "@reading-studio/providers"
import { openStorage, type Storage } from "@reading-studio/storage"
import { completeGraphFixtures } from "@reading-studio/storage/test-support"
import { afterEach, expect, it, vi } from "vitest"
import { z } from "zod"

const resources: { directory: string; storage: Storage }[] = []
afterEach(async () => {
  vi.unstubAllGlobals()
  for (const resource of resources.splice(0)) {
    resource.storage.close()
    await rm(resource.directory, { recursive: true, force: true })
  }
})

it.each(SubscriptionProvider.options)(
  "blocks %s even with an explicitly supplied API key",
  async (provider) => {
    // Given
    const network = vi.fn(async () => {
      throw new TypeError("External network forbidden")
    })
    vi.stubGlobal("fetch", network)
    const request = {
      model: "fixture-model",
      prompt: "synthetic",
      schema: { type: "object" },
      settings: {
        temperature: 0,
        topP: 1,
        seed: null,
        reasoningEffort: "default",
        maxOutputTokens: 128,
      } as const,
      signal: new AbortController().signal,
    }
    // When / Then
    await expect(async () =>
      new ProviderAdapter({ provider, apiKey: "synthetic-key" }).dispatch(request),
    ).rejects.toMatchObject({ code: "subscription-unverified" })
    expect(network).not.toHaveBeenCalled()
  },
)

it.each(SubscriptionProvider.options)(
  "pauses %s before reservation even with an injected worker adapter",
  async (provider) => {
    // Given
    const directory = await mkdtemp(join(tmpdir(), "ten21-worker-"))
    const storage = openStorage({
      databasePath: join(directory, "studio.sqlite"),
      privateDataRoot: join(directory, "private"),
    })
    resources.push({ directory, storage })
    const fixture = completeGraphFixtures()
    storage.sources.createOwner("owner-1")
    storage.sources.createInstallation({ id: "installation-1", ownerId: "owner-1" })
    storage.sources.appendEdition(fixture.edition)
    storage.sources.createStudy({ id: "study-1", ownerId: "owner-1", editionId: "edition-1" })
    storage.sources.appendNormalization({ record: fixture.normalization, parentRevisionId: null })
    const destination = {
      provider,
      accountId: "fixture-account",
      workspaceId: null,
      installationId: "installation-1",
      connectionRevision: 0,
      billingRoute: "subscription-allowance",
    }
    storage.sources.appendSetup({
      record: { ...fixture.setup, analysis: { ...fixture.setup.analysis, provider, destination } },
      parentRevisionId: null,
    })
    const grant = storage.sources.appendGrant({ ...fixture.grant, destination })
    const inputRevisionId = storage.workflow.ensureAnalysisInput(fixture.setup.id)
    storage.execution.appendRun({
      ...fixture.run,
      inputRevisionId,
      state: "running",
      reservedCalls: 0,
    })
    storage.execution.appendJob({
      ...fixture.job,
      provider,
      grant,
      inputRevisionId,
      state: "queued",
      stage: "analysis",
    })
    const now = "2026-10-19T00:00:00Z"
    const job = storage.execution.claimNextJob({
      token: "lease",
      now,
      expiresAt: "2026-10-19T00:10:00Z",
    })
    if (job?.state !== "running") throw new TypeError("Expected running fixture")
    const dispatch = vi.fn(async () => ({
      kind: "output" as const,
      text: '{"answer":"ok"}',
      usage: { kind: "known" as const, inputTokens: 1, outputTokens: 1 },
    }))
    const measure = vi.fn(async () => 100)
    const runner = new ProviderRunner({
      storage,
      installationId: "installation-1",
      ownerId: "owner-1",
      clock: () => new Date(now),
      adapters: { [provider]: { dispatch, measure } },
    })
    // When
    const result = await runner.execute(job, {
      schema: z.object({ answer: z.string() }),
      instruction: "synthetic",
    })
    // Then
    expect(result).toMatchObject({ state: "paused", reason: "owner" })
    expect(storage.execution.providerPause(job.id)?.code).toBe("subscription-unverified")
    expect(storage.execution.listAttempts(job.runId)).toHaveLength(0)
    expect(dispatch).not.toHaveBeenCalled()
    expect(measure).not.toHaveBeenCalled()
  },
)
