import { randomUUID } from "node:crypto"
import { once } from "node:events"
import { watch } from "node:fs"
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { BookMapPipeline } from "@reading-studio/generation"
import { LocalSubscriptionAdapter, ProviderRunner } from "@reading-studio/providers"
import { createApp } from "@reading-studio/server/app"
import { setupAnalysisProgress, studySetupSend } from "@reading-studio/server/study-setup-send"
import { openStorage, type Storage } from "@reading-studio/storage"
import { completeGraphFixtures } from "@reading-studio/storage/test-support"
import { afterEach, expect, it, vi } from "vitest"
import { z } from "zod"
import { WorkerRuntime } from "../src/runtime.ts"

const resources: { readonly directory: string; readonly stores: Storage[] }[] = []
afterEach(async () => {
  for (const { directory, stores } of resources.splice(0)) {
    for (const storage of stores) storage.close()
    await rm(directory, { recursive: true, force: true })
  }
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})
it.each(
  (["chatgpt-subscription", "grok-subscription"] as const).flatMap((provider) =>
    [
      "success",
      "malformed",
      "incomplete",
      "revoked",
      "revoked-inflight",
      "fallback",
      "custom-config",
      "no-stage",
      ...(provider === "chatgpt-subscription" ? ["bad-request"] : []),
    ].map((scenario) => ({ provider, scenario })),
  ),
)(
  "handles $scenario Send through $provider without accepting incomplete or unapproved output",
  async ({ provider, scenario }) => {
    // Given
    const network = vi.fn(async () => {
      throw new TypeError("Network forbidden")
    })
    vi.stubGlobal("fetch", network)
    const directory = await mkdtemp(join(tmpdir(), "ten21-send-"))
    const binary = join(directory, "tool-fixture")
    const control = join(directory, "control")
    await mkdir(control)
    const kind = provider === "chatgpt-subscription" ? "codex" : "grok"
    await writeFile(
      binary,
      `#!/bin/sh\nexec "${process.execPath}" "${resolve("packages/storage/tests/subscription-execution-fixture.cjs")}" kind:${kind} scenario:${scenario} "control:${control}" "$@"\n`,
      { mode: 0o700 },
    )
    vi.stubEnv(
      provider === "chatgpt-subscription"
        ? "STUDIO_SUBSCRIPTION_CODEX_BINARY"
        : "STUDIO_SUBSCRIPTION_GROK_BINARY",
      binary,
    )
    const options = {
      databasePath: join(directory, "studio.sqlite"),
      privateDataRoot: join(directory, "private"),
    }
    const storage = openStorage(options)
    const stores = [storage]
    resources.push({ directory, stores })
    const ownerId = storage.libraryOwnerId()
    const installationId = storage.sources.createInstallation({ id: randomUUID(), ownerId })
    const fixture = completeGraphFixtures()
    storage.sources.persistDocument({
      edition: fixture.edition,
      normalization: fixture.normalization,
    })
    storage.sources.createStudy({
      id: fixture.setup.studyId,
      ownerId,
      editionId: fixture.edition.id,
    })
    const login =
      provider === "chatgpt-subscription"
        ? storage.subscriptionLogin
        : storage.grokSubscriptionLogin
    await login.connect(installationId)
    await login.settled(installationId)
    const authority = { storage, ownerId, installationId, localSubscriptions: true }
    const app = createApp({
      serverHost: "127.0.0.1",
      reviewStorage: storage,
      sources: storage.sources,
      libraryOwnerId: ownerId,
      ...(scenario === "no-stage"
        ? {}
        : { onSetupSend: studySetupSend(storage, scenario === "success", true) }),
      security: {
        trustedOrigins: ["http://127.0.0.1:8787"],
        trustProxy: false,
        apiBodyBytes: 8192,
        loginBodyBytes: 4096,
        loginRateLimit: { attempts: 5, windowMs: 60000 },
        uploadBodyBytes: 8192,
      },
    })
    const post = (path: string, body: unknown) =>
      app.request(`http://127.0.0.1:8787${path}`, {
        method: "POST",
        headers: { origin: "http://127.0.0.1:8787", "content-type": "application/json" },
        body: JSON.stringify(body),
      })
    // When
    const drafted = await post(`/api/study-setup/${fixture.normalization.id}`, {
      provider,
      model: "study-model",
    })
    if (scenario === "custom-config") {
      expect(drafted.status).toBe(409)
      expect(storage.counts()).toMatchObject({ grants: 0, attempts: 0 })
      expect(network).not.toHaveBeenCalled()
      return
    }
    expect(drafted.status).toBe(201)
    const { setupId } = z.object({ setupId: z.string() }).parse(await drafted.json())
    if (scenario === "revoked") await login.disconnect(installationId)
    const sent = await post(`/api/study-setup/${fixture.normalization.id}/${setupId}`, {
      decision: "send",
    })
    if (scenario === "revoked") {
      expect(sent.status).toBe(409)
      expect(storage.counts()).toMatchObject({ grants: 0, attempts: 0 })
      expect(network).not.toHaveBeenCalled()
      return
    }
    expect(sent.status).toBe(200)
    const receipt: unknown = await sent.json()
    const { grantId } = z.object({ grantId: z.string() }).parse(receipt)
    if (scenario === "no-stage") {
      expect(receipt).toMatchObject({ analysisProgress: "not-scheduled" })
      expect(storage.counts()).toMatchObject({ jobs: 0, attempts: 0 })
      expect(network).not.toHaveBeenCalled()
      return
    }
    expect(storage.counts()).toMatchObject({ jobs: 1, attempts: 0 })
    expect(receipt).toMatchObject({ analysisProgress: "queued" })
    const worker = new WorkerRuntime({
      storage,
      clock: () => new Date(),
      leaseDurationMs: 120000,
      tokenFactory: randomUUID,
      attemptIdFactory: () => randomUUID(),
      resolveStage: (job) => ({
        kind: "structured",
        runner: new ProviderRunner({
          ...authority,
          clock: () => new Date(),
          adapters: {
            [provider]: new LocalSubscriptionAdapter(authority, job),
          },
        }),
        request: new BookMapPipeline(authority).stage(job),
      }),
    })
    const observer = scenario === "revoked-inflight" ? watch(control) : null
    const notified = observer
      ? once(observer, "change", { signal: AbortSignal.timeout(5000) })
      : null
    const running = worker.runNext()
    if (observer && notified) {
      try {
        await notified
      } finally {
        observer.close()
      }
      await login.disconnect(installationId)
    }
    const result = await running
    if (scenario === "revoked-inflight") {
      expect(result.kind === "provider" && result.job.state).not.toBe("completed")
      expect(storage.counts().attempts).toBe(1)
      expect(network).not.toHaveBeenCalled()
      return
    }
    const analysis = new BookMapPipeline(authority).prepare(setupId, grantId)
    const savedSetup = storage.sources.getSetup(setupId)
    if (!savedSetup) throw new TypeError("Missing synthetic setup")
    // Then
    if (scenario !== "success") {
      expect(result.kind === "provider" && result.job.state).not.toBe("completed")
      expect(analysis.status).toBe("partial")
      expect(setupAnalysisProgress(storage, savedSetup, grantId)).toBe("attention")
      expect(storage.counts().attempts).toBe(scenario === "malformed" ? 2 : 1)
      if (scenario === "bad-request") {
        const attempt = storage.execution
          .listAttempts(result.kind === "provider" ? result.job.runId : "unavailable")
          .at(-1)
        if (!attempt) throw new TypeError("Missing fixture attempt")
        const body = storage.execution.getAttemptReceipt(attempt.id)
        if (!body) throw new TypeError("Missing fixture receipt")
        const text = new TextDecoder().decode(body)
        const classification = z
          .object({ kind: z.string(), code: z.string(), diagnostic: z.string().optional() })
          .parse(JSON.parse(text))
        expect(classification).toMatchObject({
          kind: "error",
          code: "rejected",
          diagnostic: "request-rejected",
        })
        expect(text.includes("PRIVATE_DIAGNOSTIC_SENTINEL")).toBe(false)
      }
      if (scenario === "fallback")
        await expect(access(join(control, "sent"))).rejects.toMatchObject({ code: "ENOENT" })
      expect(network).not.toHaveBeenCalled()
      return
    }
    expect(result.kind === "provider" && result.job.state).toBe("completed")
    expect(analysis.status).toBe("successful")
    expect(setupAnalysisProgress(storage, savedSetup, grantId)).toBe("analysis-ready")
    expect(analysis.claims).toHaveLength(1)
    expect(analysis.claims[0]?.sources[0]?.resourcePath).toBe(
      fixture.normalization.resources[0]?.path,
    )
    const reopened = openStorage(options)
    stores.push(reopened)
    expect(reopened.workflow.getAnalysis(analysis.id)?.status).toBe("successful")
    const revision = await app.request(
      `http://127.0.0.1:8787/api/revision-page/${fixture.setup.studyId}`,
    )
    expect(await revision.json()).toMatchObject({ available: true })
    expect(storage.counts().attempts).toBe(1)
    expect(network).not.toHaveBeenCalled()
  },
)
