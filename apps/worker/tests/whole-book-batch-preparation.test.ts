import { createApp } from "@reading-studio/server/app"
import { afterEach, expect, it } from "vitest"
import { batchRuntimeFixture } from "./whole-book-batch-runtime-fixture.ts"

const fixtures: Awaited<ReturnType<typeof batchRuntimeFixture>>[] = []
afterEach(async () => {
  for (const item of fixtures.splice(0)) await item.fixture.close()
})
it("exposes the full reserved job/attempt maximum and unknown-output refusal limits before v4 consent", async () => {
  // Given
  const item = await batchRuntimeFixture(4, false)
  fixtures.push(item)
  const app = createApp({
    reviewStorage: item.fixture.storage,
    sources: item.fixture.storage.sources,
    libraryOwnerId: "owner-1",
    bookMapCapacity: item.execution.capacity,
    security: {
      trustedOrigins: ["http://127.0.0.1:8787"],
      trustProxy: false,
      apiBodyBytes: 8192,
      loginBodyBytes: 4096,
      loginRateLimit: { attempts: 5, windowMs: 60000 },
      uploadBodyBytes: 8192,
    },
  })
  // When
  const response = await app.request(
    `http://127.0.0.1:8787/api/study-setup/${item.execution.normalization.id}/${item.setup.id}`,
  )
  const result: unknown = await response.json()
  // Then
  expect(response.status).toBe(200)
  expect(result).toMatchObject({
    preparation: {
      state: "ready",
      batchedMaximum: {
        reserveId: item.reserve.id,
        maxFindingBatches: 4,
        maxVerificationJobs: 14,
        maxAnalysisJobs: 17,
        maxAnalysisAttempts: 34,
        reservedLaterAttempts: 12,
        maxTotalAttempts: 46,
        outputFitGuaranteed: false,
      },
    },
  })
  expect(item.fixture.storage.sources.getGrant("grant-batch4")).toBeNull()
  expect(item.fixture.storage.counts()).toMatchObject({ jobs: 0, attempts: 0 })
})
