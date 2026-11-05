import { randomUUID } from "node:crypto"
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { serve } from "@hono/node-server"
import { contentDigest, fullBookManagedThread, localToolInput } from "@reading-studio/contracts"
import { serializeRpcFrame } from "@reading-studio/storage"
import { z } from "zod"
import { createApp } from "../app.ts"
import type { FullBookPreparationOptions } from "../full-book-preparation.ts"
import { loadStudioAssets } from "../studio-assets.ts"
import { controlledFullBookOutput } from "./full-book-controlled-output.ts"
import { preparationFixture } from "./full-book-preparation-fixture.ts"
import { fixtureRuntimePolicy } from "./full-book-runtime-fixture.ts"

export function fullBookServerFixture(assetDirectory?: string) {
  const f = preparationFixture(),
    directory = mkdtempSync(join(tmpdir(), "full-book-bound-runtime-")),
    cwd = mkdtempSync(join(realpathSync("/tmp"), "tenjinsan-study-")),
    binaryPath = join(directory, "fixture.mjs"),
    bytes = "// registered synthetic build; never a live tool\n"
  writeFileSync(binaryPath, bytes)
  f.storage.fullBookConsent.close(f.budget.id, "Close prior fixture hold")
  f.storage.subscriptionLogin.status = () => f.state
  f.storage.subscriptionLogin.canDispatch = () => false
  f.storage.subscriptionLogin.profileBlocked = () => false
  f.storage.subscriptionLogin.refresh = async () => {
    throw new TypeError("Discovery forbidden")
  }
  f.storage.subscriptionLogin.withSession = async () => {
    throw new TypeError("Real execution forbidden")
  }
  const options = {
    mode: "full-book-test-1",
    policy: f.budget.session.input.policy,
    sourceCeiling: 100,
    collectorBytes: 10000,
    timeoutMs: 1000,
  }
  let mode:
    | "complete"
    | "unknown"
    | "received"
    | "received-unknown-usage"
    | "failed"
    | "bootstrap-failure"
    | "stall" = "complete"
  let release: () => void = () => {}
  let started = Promise.withResolvers<void>()
  const runtime = {
    resolve: (input: FullBookPreparationOptions) => fixtureRuntimePolicy(binaryPath, bytes, input),
    execute: async (id: string, signal: AbortSignal) => {
      const { grant, budget } = f.storage.fullBookManagedConsents.read(id),
        now = new Date().toISOString()
      const lease = f.storage.fullBookExecution.claim({
        consentId: budget.id,
        token: randomUUID(),
        now,
        expiresAt: new Date(Date.now() + grant.policy.timeoutMs + 30000).toISOString(),
      })
      if (!lease) return
      const prepared = f.storage.fullBookExecution.reserve({
        lease,
        now,
        threadId: "fixture-unstarted",
        rpcId: 1,
      })
      f.storage.fullBookExecution.beforeWrite({ lease, attemptId: prepared.attempt.id, now })
      const thread = serializeRpcFrame({
        provider: "chatgpt-subscription",
        id: 100,
        method: "thread/start",
        params: fullBookManagedThread(budget.session.model, cwd),
        binding: lease.targetHash,
      })
      f.storage.fullBookManagedConsents.recordThread(id, prepared.attempt.id, {
        frame: thread,
        recordedAt: now,
      })
      if (mode === "bootstrap-failure") {
        f.storage.fullBookManagedConsents.failure(id, prepared.attempt.id, {
          reason: "synthetic-bootstrap-failure",
          observedUsage: { kind: "unknown" },
          collectedBytes: 0,
          partialAccepted: false,
        })
        f.storage.fullBookExecution.interrupt({ lease, attemptId: prepared.attempt.id })
        return
      }
      const freshThreadId = randomUUID(),
        request = z
          .object({
            model: z.string(),
            prompt: z.string(),
            schema: z.record(z.string(), z.unknown()),
          })
          .parse(JSON.parse(prepared.wire.requestJson))
      const turn = serializeRpcFrame({
        provider: "chatgpt-subscription",
        id: 101,
        method: "turn/start",
        params: { threadId: freshThreadId, ...localToolInput("chatgpt-subscription", request) },
        binding: lease.targetHash,
      })
      f.storage.fullBookManagedConsents.recordFrames(id, prepared.attempt.id, {
        evidence: "experimental-app-bounded",
        thread,
        turn,
        buildKind: "fixture-not-live-evidence",
        policyHash: contentDigest(JSON.stringify(grant.policy)),
        freshThreadId,
        recordedAt: now,
      })
      started.resolve()
      if (mode === "stall")
        await new Promise<void>((resolve) => {
          release = resolve
          signal.addEventListener("abort", () => resolve(), { once: true })
        })
      if (mode === "unknown" || signal.aborted) {
        f.storage.fullBookManagedConsents.failure(id, prepared.attempt.id, {
          reason: "synthetic-unknown",
          observedUsage: { kind: "unknown" },
          collectedBytes: 0,
          partialAccepted: false,
        })
        f.storage.fullBookExecution.interrupt({ lease, attemptId: prepared.attempt.id })
        return
      }
      f.storage.fullBookExecution.receive({
        attemptId: prepared.attempt.id,
        dispatchKey: prepared.wire.dispatchKey,
        serialized: JSON.stringify(
          controlledFullBookOutput(budget.session, f.storage.fullBookExecution.receipts(budget.id)),
        ),
        usage:
          mode === "received-unknown-usage"
            ? { kind: "unknown" }
            : { kind: "known", inputTokens: 8, outputTokens: 4 },
        receivedAt: now,
        metadata: {
          transport: "managed-experimental-app-bounded",
          threadId: freshThreadId,
          requestId: turn.id,
          wireHash: turn.sha256,
          targetHash: lease.targetHash,
          turnId: randomUUID(),
          terminal: mode === "failed" ? "failed" : "completed",
        },
      })
      if (mode !== "received" && mode !== "received-unknown-usage")
        f.storage.fullBookExecution.accept({ lease, attemptId: prepared.attempt.id, now })
    },
  }
  const makeApp = (origin: string) =>
    createApp({
      ...(assetDirectory ? { studioAssets: loadStudioAssets(assetDirectory) } : {}),
      reviewStorage: f.storage,
      libraryOwnerId: f.budget.ownerId,
      sources: f.storage.sources,
      serverHost: "127.0.0.1",
      fullBookRuntime: runtime,
      security: {
        trustedOrigins: [origin],
        trustProxy: false,
        apiBodyBytes: 100000,
        loginBodyBytes: 10000,
        uploadBodyBytes: 100000,
        loginRateLimit: { attempts: 5, windowMs: 1000 },
      },
    })
  const app = makeApp("http://localhost:8787")
  const post = (action: string, value: unknown) =>
    app.request(`/api/full-book-test/${f.setup.id}/${action}`, {
      method: "POST",
      headers: {
        origin: "http://localhost:8787",
        host: "localhost:8787",
        "content-type": "application/json",
      },
      body: JSON.stringify(value),
    })
  return {
    ...f,
    app,
    post,
    options,
    binaryPath,
    runtime,
    setMode(value: typeof mode) {
      mode = value
      started = Promise.withResolvers<void>()
    },
    whenStarted() {
      return started.promise
    },
    release() {
      release()
    },
    async listen() {
      let current = app
      const server = serve({
        fetch: (request) => current.fetch(request),
        hostname: "127.0.0.1",
        port: 0,
      })
      await new Promise<void>((resolve) => server.on("listening", resolve))
      const address = server.address()
      if (!address || typeof address === "string") throw new TypeError("Missing fixture listener")
      const origin = `http://127.0.0.1:${address.port}`
      current = makeApp(origin)
      return {
        origin,
        storage: f.storage,
        setupId: f.setup.id,
        revision: f.setup.analysis.normalizationRevisionId,
        async close() {
          release()
          await new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          )
          f.cleanup()
          rmSync(directory, { recursive: true, force: true })
          rmSync(cwd, { recursive: true, force: true })
        },
      }
    },
    cleanup() {
      release()
      f.cleanup()
      rmSync(directory, { recursive: true, force: true })
      rmSync(cwd, { recursive: true, force: true })
    },
  }
}

export { fullBookConsentInput } from "./full-book-consent-input.ts"
