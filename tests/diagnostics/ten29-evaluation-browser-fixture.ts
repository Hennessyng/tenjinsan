import { once } from "node:events"
import { createServer } from "node:http"
import { resolve } from "node:path"
import { getRequestListener } from "@hono/node-server"
import { createApp } from "@reading-studio/server/app"
import { studySetupSend } from "@reading-studio/server/study-setup-send"
import { expect } from "vitest"
import { loadStudioAssets } from "../../apps/server/src/studio-assets.ts"
import { analysisPurposeFixture } from "../../apps/worker/tests/analysis-purpose-fixture.ts"
import {
  bookFixtureAuthority,
  bookFixtureCapacity,
  bookFixtureTurns,
} from "../../apps/worker/tests/book-map-route-fixture.ts"

export async function completedEvaluationBrowserFixture() {
  console.info("TEN29 terminal fixture: preparing owned source")
  const item = await analysisPurposeFixture()
  const server = createServer()
  try {
    const { pipeline, worker } = item.runtime()
    let analysis = pipeline.prepare(item.setup.id, item.grant.id)
    for (let step = 0; step < 20 && analysis.status !== "successful"; step++) {
      await worker.runNext()
      analysis = pipeline.prepare(item.setup.id, item.grant.id)
      console.info(`TEN29 terminal fixture: completed step ${step + 1}, status=${analysis.status}`)
    }
    expect(analysis.status).toBe("successful")
    expect(analysis.wholeBook?.terminal).toBe("verified-analysis")
    expect(bookFixtureTurns(item.fixture)).toHaveLength(5)
    expect(item.fixture.storage.counts()).toMatchObject({
      questions: 0,
      outlines: 0,
      lessons: 0,
      publications: 0,
      artifacts: 0,
    })
    server.listen(0, "127.0.0.1")
    await once(server, "listening")
    console.info("TEN29 terminal fixture: owned HTTP server listening")
    const address = server.address()
    if (!address || typeof address === "string")
      throw new TypeError("Missing owned browser address")
    const origin = `http://127.0.0.1:${address.port}`
    bookFixtureAuthority(item.fixture)
    const app = createApp({
      serverHost: "127.0.0.1",
      sources: item.fixture.storage.sources,
      reviewStorage: item.fixture.storage,
      interviews: item.fixture.storage.interviews,
      libraryOwnerId: "owner-1",
      bookMapCapacity: bookFixtureCapacity,
      studioAssets: loadStudioAssets(resolve("apps/studio/dist")),
      onSetupSend: studySetupSend(item.fixture.storage, true, {
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
    server.on("request", getRequestListener(app.fetch))
    const saved = await (
      await app.request(`${origin}/api/study-setup/${item.normalization.id}/${item.setup.id}`)
    ).json()
    expect(saved).toMatchObject({
      terminal: "verified-analysis",
      canResume: false,
      purpose: item.setup.analysis.purpose,
    })
    expect(saved).not.toHaveProperty("questionsUrl")
    console.info("TEN29 terminal fixture: persisted terminal response verified")
    return {
      harness: {
        origin,
        sourceStorage: item.fixture.storage,
        close: async () => {
          await new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          )
          await item.fixture.close()
        },
      },
      revision: item.normalization.id,
      setupId: item.setup.id,
      studyId: item.setup.studyId,
      url: `${origin}/sources/${item.normalization.id}/setup/${item.setup.id}`,
      evidence: {
        setup: item.setup,
        saved,
        analysis,
        counts: item.fixture.storage.counts(),
        allowance: item.fixture.storage.liveStudyGuard.sharedStatus(item.setup.id),
        nativeTurns: bookFixtureTurns(item.fixture).length,
        liveCalls: false,
      },
    }
  } catch (error) {
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()))
    await item.fixture.close()
    throw error
  }
}
