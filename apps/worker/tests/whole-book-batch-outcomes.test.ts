import { queueQuestions } from "@reading-studio/generation/queue-questions"
import { createApp } from "@reading-studio/server/app"
import { afterEach, expect, it } from "vitest"
import { z } from "zod"
import {
  BatchedRuntimeAdapter,
  batchRuntimeFixture,
  finishBatchRuntime,
} from "./whole-book-batch-runtime-fixture.ts"

const fixtures: Awaited<ReturnType<typeof batchRuntimeFixture>>[] = []
afterEach(async () => {
  for (const item of fixtures.splice(0)) await item.fixture.close()
})
it("keeps a fully accounted but contradicted matrix blocked and ineligible for downstream questions", async () => {
  const item = await batchRuntimeFixture()
  fixtures.push(item)
  const { analysis } = await finishBatchRuntime(item, new BatchedRuntimeAdapter("contradicted"))
  expect(analysis.status).toBe("partial")
  expect(analysis.wholeBook?.phase).toBe("blocked")
  expect(item.fixture.storage.workflow.findSuccessfulAnalysis(analysis.cacheKey)).toBeNull()
  const before = item.fixture.storage.counts()
  queueQuestions(item.fixture.storage, item.setup.id, item.grant.id, analysis)
  expect(item.fixture.storage.counts()).toEqual(before)
  expect(
    item.fixture.storage.execution
      .listSetupJobs(item.setup.id)
      .some((job) => job.stage === "questions"),
  ).toBe(false)
  const app = createApp({
    reviewStorage: item.fixture.storage,
    sources: item.fixture.storage.sources,
    libraryOwnerId: "owner-1",
    security: {
      trustedOrigins: ["http://127.0.0.1:8787"],
      trustProxy: false,
      apiBodyBytes: 8192,
      loginBodyBytes: 4096,
      loginRateLimit: { attempts: 5, windowMs: 60000 },
      uploadBodyBytes: 8192,
    },
  })
  const response = await app.request("http://127.0.0.1:8787/api/study-jobs")
  const jobs = z
    .object({
      jobs: z.array(
        z.object({ setupRevisionId: z.string(), semanticSupport: z.string().optional() }),
      ),
    })
    .parse(await response.json())
    .jobs.filter((job) => job.setupRevisionId === item.setup.id)
  const state = analysis.wholeBook?.batched
  if (!state?.manifest) throw new TypeError("Missing accounted matrix")
  expect(jobs.filter((job) => job.semanticSupport === "attention")).toHaveLength(
    state.manifest.batches.length * state.reserve.windowHashes.length,
  )
})
