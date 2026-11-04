import { BATCHED_VERIFICATION_VERSION } from "@reading-studio/contracts"
import { BookMapPipeline } from "@reading-studio/generation"
import {
  legacyLocalReservationBytes as localRequestBytes,
  ProviderRunner,
} from "@reading-studio/providers"
import { uploadHarness } from "@reading-studio/server/upload-fixture"
import { afterEach, expect, it } from "vitest"
import { z } from "zod"
import { WorkerRuntime } from "../src/runtime.ts"
import { BatchedRuntimeAdapter } from "./whole-book-batch-runtime-fixture.ts"

const harnesses: Awaited<ReturnType<typeof uploadHarness>>[] = []
afterEach(async () => {
  for (const harness of harnesses.splice(0)) await harness.close()
})
it("takes a normal HTTP draft through visible bounded review and explicit consent into version4 jobs with a fake local client", async () => {
  // Given
  const harness = await uploadHarness({
    managedChatGPT: true,
    localSubscriptions: true,
    managedCapacity: true,
    queueAnalysis: true,
    providerAvailable: true,
  })
  harnesses.push(harness)
  const imported = await fetch(`${harness.origin}/api/imports/upload`, {
    method: "POST",
    headers: { ...harness.headers, "content-type": "text/plain" },
    body: "Synthetic opening rule.\n\nA later qualification.",
  })
  const revision = z
    .object({ normalizationRevisionId: z.string() })
    .parse(await imported.json()).normalizationRevisionId
  const drafted = await fetch(`${harness.origin}/api/study-setup/${revision}`, {
    method: "POST",
    headers: { origin: harness.origin, "content-type": "application/json" },
    body: JSON.stringify({ provider: "chatgpt-subscription", model: "study-model" }),
  })
  const setupId = z.object({ setupId: z.string() }).parse(await drafted.json()).setupId
  // When
  const reviewed = await fetch(`${harness.origin}/api/study-setup/${revision}/${setupId}`)
  const review = z
    .object({
      preparation: z.object({
        state: z.string(),
        batchedMaximum: z.object({
          maxTotalAttempts: z.number(),
          outputFitGuaranteed: z.boolean(),
        }),
      }),
    })
    .parse(await reviewed.json())
  const setup = harness.sourceStorage.sources.getSetup(setupId)
  expect(setup?.analysis.processing?.synthesisVersion).toBe(BATCHED_VERIFICATION_VERSION)
  expect(review.preparation.state).toBe("ready")
  expect(review.preparation.batchedMaximum.outputFitGuaranteed).toBe(false)
  expect(harness.sourceStorage.counts()).toMatchObject({ grants: 0, jobs: 0, attempts: 0 })
  const sent = await fetch(`${harness.origin}/api/study-setup/${revision}/${setupId}`, {
    method: "POST",
    headers: { origin: harness.origin, "content-type": "application/json" },
    body: JSON.stringify({ decision: "send" }),
  })
  const consent = z.object({ grantId: z.string() }).parse(await sent.json())
  const capacity = harness.managed?.capacity
  if (!capacity?.destination || !setup?.batchedVerificationReserve)
    throw new TypeError("Missing reviewed bound route")
  const authority = {
    storage: harness.sourceStorage,
    ownerId: harness.sourceStorage.libraryOwnerId(),
    installationId: capacity.destination.installationId,
    localSubscriptions: true,
    capacity,
  }
  const pipeline = new BookMapPipeline(authority),
    adapter = new BatchedRuntimeAdapter()
  const worker = new WorkerRuntime({
    storage: harness.sourceStorage,
    clock: () => new Date("2026-10-28T00:00:00Z"),
    leaseDurationMs: 120000,
    tokenFactory: () => "normal-http-v4",
    attemptIdFactory: (n) => `normal-http-attempt-${n}`,
    resolveStage: (job) => ({
      kind: "structured",
      request: pipeline.stage(job),
      runner: new ProviderRunner({
        ...authority,
        clock: () => new Date("2026-10-28T00:00:00Z"),
        adapters: {
          "chatgpt-subscription": {
            measure: async (request) => localRequestBytes("chatgpt-subscription", request),
            dispatch: (request) => adapter.dispatch(request),
          },
        },
      }),
    }),
  })
  let analysis = pipeline.prepare(setupId, consent.grantId)
  for (let step = 0; step < 64; step++) {
    if ((await worker.runNext()).kind === "idle") break
    analysis = pipeline.prepare(setupId, consent.grantId)
  }
  // Then
  expect(analysis.status).toBe("successful")
  expect(analysis.wholeBook?.batched?.reserve).toEqual(setup.batchedVerificationReserve)
  expect(adapter.requests.length).toBeLessThanOrEqual(
    setup.batchedVerificationReserve.maxAnalysisJobs * 2,
  )
  expect(harness.managed?.session).not.toHaveBeenCalled()
})
