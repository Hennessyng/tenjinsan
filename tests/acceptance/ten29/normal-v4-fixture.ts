import { createApp } from "@reading-studio/server/app"
import { studySetupSend } from "@reading-studio/server/study-setup-send"
import { z } from "zod"
import {
  bookFixtureAuthority,
  bookFixtureCapacity,
  bookFixtureTurns,
} from "../../../apps/worker/tests/book-map-route-fixture.ts"
import { BatchedRuntimeAdapter } from "../../../apps/worker/tests/whole-book-batch-runtime-fixture.ts"
import { wholeBookWorker } from "../../../apps/worker/tests/whole-book-fixture.ts"
import type { persistedSource } from "./persisted-source.ts"

export async function exerciseNormalV4(
  fixture: Pick<
    Awaited<ReturnType<typeof persistedSource>>,
    "normalization" | "directory" | "databasePath" | "privateDataRoot" | "storage" | "close"
  >,
  adapter = new BatchedRuntimeAdapter(),
) {
  bookFixtureAuthority(fixture)
  const origin = "http://127.0.0.1:8787"
  const app = createApp({
    serverHost: "127.0.0.1",
    reviewStorage: fixture.storage,
    sources: fixture.storage.sources,
    libraryOwnerId: "owner-1",
    bookMapCapacity: bookFixtureCapacity,
    onSetupSend: studySetupSend(fixture.storage, true, {
      localSubscriptions: true,
      capacity: bookFixtureCapacity,
    }),
    security: {
      trustedOrigins: [origin],
      trustProxy: false,
      apiBodyBytes: 8192,
      loginBodyBytes: 4096,
      loginRateLimit: { attempts: 5, windowMs: 60000 },
      uploadBodyBytes: 8192,
    },
  })
  const response = await app.request(`${origin}/api/study-setup/${fixture.normalization.id}`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ provider: "chatgpt-subscription", model: "study-model" }),
  })
  const setupId = z.object({ setupId: z.string() }).parse(await response.json()).setupId
  const setup = fixture.storage.sources.getSetup(setupId)
  if (!setup) throw new TypeError("Missing normal draft")
  const reviewResponse = await app.request(
    `${origin}/api/study-setup/${fixture.normalization.id}/${setupId}`,
  )
  const review: unknown = await reviewResponse.json()
  const parsed = z.object({ preparation: z.object({ state: z.string() }) }).parse(review)
  if (parsed.preparation.state !== "ready")
    return {
      kind: "refused-before-consent" as const,
      setup,
      review,
      jobs: fixture.storage.execution.listSetupJobs(setupId),
      native: bookFixtureTurns(fixture),
    }
  const sent = await app.request(
    `${origin}/api/study-setup/${fixture.normalization.id}/${setupId}`,
    {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ decision: "send" }),
    },
  )
  const grantId = z.object({ grantId: z.string() }).parse(await sent.json()).grantId
  const run = wholeBookWorker(fixture, adapter)
  let analysis = run.pipeline.prepare(setupId, grantId)
  for (let step = 0; step < 64; step++) {
    if ((await run.worker.runNext()).kind === "idle") break
    analysis = run.pipeline.prepare(setupId, grantId)
  }
  return {
    kind: "processed" as const,
    setup,
    review,
    grantId,
    analysis,
    jobs: fixture.storage.execution.listSetupJobs(setupId),
    native: bookFixtureTurns(fixture),
    requests: adapter.requests.length,
  }
}
