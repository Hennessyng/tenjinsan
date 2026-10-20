import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { SubscriptionProvider, subscriptionDestination } from "@reading-studio/contracts"
import { ProviderError } from "@reading-studio/providers"
import { openStorage, type Storage } from "@reading-studio/storage"
import { completeGraphFixtures } from "@reading-studio/storage/test-support"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { z } from "zod"
import { runProductionWorker } from "../src/production-runtime.ts"
import { WorkerRuntime } from "../src/runtime.ts"

const resources: { readonly directory: string; readonly storage: Storage }[] = []
const network = vi.fn(async () => {
  throw new TypeError("Network forbidden in production subscription tests")
})
beforeEach(() => {
  network.mockClear()
  vi.stubGlobal("fetch", network)
  vi.stubEnv("OPENROUTER_API_KEY", "")
  vi.stubEnv("ANTHROPIC_API_KEY", "")
  vi.stubEnv("SERVER_HOST", "127.0.0.1")
  vi.stubEnv("TRUST_PROXY", "0")
  vi.stubEnv("TRUSTED_ORIGINS", "http://127.0.0.1:8787")
})
afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  for (const resource of resources.splice(0)) {
    resource.storage.close()
    await rm(resource.directory, { recursive: true, force: true })
  }
})

async function queuedSubscription(provider: SubscriptionProvider, signIn = false) {
  const directory = await mkdtemp(join(tmpdir(), "ten21-production-"))
  const databasePath = join(directory, "studio.sqlite")
  const privateDataRoot = join(directory, "private")
  const storage = openStorage({ databasePath, privateDataRoot })
  resources.push({ directory, storage })
  const fixture = completeGraphFixtures()
  storage.sources.createOwner("owner-1")
  storage.sources.createInstallation({ id: "installation-1", ownerId: "owner-1" })
  storage.sources.appendEdition(fixture.edition)
  storage.sources.createStudy({ id: "study-1", ownerId: "owner-1", editionId: "edition-1" })
  storage.sources.appendNormalization({ record: fixture.normalization, parentRevisionId: null })
  if (signIn) {
    const binary = join(directory, "grok-fixture")
    await writeFile(
      binary,
      `#!/bin/sh\nexec "${process.execPath}" "${resolve("packages/storage/tests/subscription-grok-fixture.cjs")}" fixture:changed-account "$@"\n`,
      { mode: 0o700 },
    )
    vi.stubEnv("STUDIO_SUBSCRIPTION_GROK_BINARY", binary)
    await storage.grokSubscriptionLogin.connect("installation-1")
    await storage.grokSubscriptionLogin.settled("installation-1")
  }
  const destination = signIn
    ? subscriptionDestination(
        "grok-subscription",
        "installation-1",
        storage.grokSubscriptionLogin.status("installation-1"),
      )
    : {
        provider,
        accountId: signIn ? "user-fixture" : "fixture-account",
        workspaceId: null,
        installationId: "installation-1",
        connectionRevision: storage.subscriptionConnections.revision("installation-1", provider),
        billingRoute: signIn ? "subscription-provider-managed" : "subscription-allowance",
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
    inputRevisionId,
    provider,
    grant,
    state: "queued",
    stage: "analysis",
  })
  return { storage, databasePath, privateDataRoot }
}

it.each(
  SubscriptionProvider.options.flatMap((provider) =>
    [false, true].map((disconnected) => ({ provider, disconnected })),
  ),
)(
  "production worker durably pauses $provider (disconnected=$disconnected) instead of exiting with a lease",
  async ({ provider, disconnected }) => {
    // Given
    const { storage, databasePath, privateDataRoot } = await queuedSubscription(provider)
    if (disconnected) storage.subscriptionConnections.disconnect("installation-1", provider)
    const code = disconnected ? "subscription-connection-changed" : "subscription-unverified"
    vi.stubEnv("DATABASE_PATH", databasePath)
    vi.stubEnv("PRIVATE_DATA_ROOT", privateDataRoot)
    const stop = new AbortController()
    const signal = AbortSignal.any([stop.signal, AbortSignal.timeout(2000)])
    vi.spyOn(console, "info").mockImplementation((message: unknown) => {
      if (typeof message !== "string") return
      const event = z
        .object({
          event: z.literal("provider-paused"),
          jobId: z.literal("job-1"),
          code: z.literal(code),
        })
        .safeParse(JSON.parse(message))
      if (event.success) stop.abort()
    })
    // When
    try {
      await expect(runProductionWorker(signal)).resolves.toBeUndefined()
    } finally {
      stop.abort()
    }
    // Then
    expect(storage.execution.getJob("job-1")).toMatchObject({ state: "paused", reason: "owner" })
    expect(storage.execution.getJob("job-1")).not.toHaveProperty("lease")
    expect(storage.execution.providerPause("job-1")?.code).toBe(code)
    expect(storage.execution.getRun("run-1")).toMatchObject({ state: "paused", reservedCalls: 0 })
    expect(storage.execution.listAttempts("run-1")).toEqual([])
    expect(
      storage.execution.claimNextJob({
        token: "no-replay",
        now: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 120000).toISOString(),
      }),
    ).toBeNull()
    expect(network).not.toHaveBeenCalled()
  },
)

it.each([new TypeError("Synthetic stage fault"), new ProviderError("unauthorized")])(
  "does not swallow unrelated stage-resolution failure: %s",
  async (error) => {
    // Given
    const { storage } = await queuedSubscription("grok-subscription")
    const worker = new WorkerRuntime({
      storage,
      clock: () => new Date(),
      leaseDurationMs: 120000,
      tokenFactory: () => "lease",
      attemptIdFactory: () => "never-reserve",
      resolveStage: () => {
        throw error
      },
    })
    // When / Then
    await expect(worker.runNext()).rejects.toBe(error)
    expect(storage.execution.providerPause("job-1")).toBeNull()
    expect(storage.execution.listAttempts("run-1")).toEqual([])
    expect(network).not.toHaveBeenCalled()
  },
)

it("refreshes the official local session before production stage resolution and pauses changed identity", async () => {
  // Given
  const { storage, databasePath, privateDataRoot } = await queuedSubscription(
    "grok-subscription",
    true,
  )
  vi.stubEnv("DATABASE_PATH", databasePath)
  vi.stubEnv("PRIVATE_DATA_ROOT", privateDataRoot)
  const stop = new AbortController()
  vi.spyOn(console, "info").mockImplementation((message: unknown) => {
    if (
      typeof message === "string" &&
      z.object({ event: z.literal("provider-paused") }).safeParse(JSON.parse(message)).success
    )
      stop.abort()
  })
  // When
  try {
    await runProductionWorker(AbortSignal.any([stop.signal, AbortSignal.timeout(3000)]))
  } finally {
    stop.abort()
  }
  // Then
  expect(storage.execution.providerPause("job-1")?.code).toBe("subscription-connection-changed")
  expect(storage.grokSubscriptionLogin.status("installation-1").account?.accountId).toBe(
    "user-other",
  )
  expect(storage.execution.getRun("run-1")?.reservedCalls).toBe(0)
  expect(storage.execution.listAttempts("run-1")).toEqual([])
  expect(network).not.toHaveBeenCalled()
})
