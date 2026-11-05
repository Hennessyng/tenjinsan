import { createApp } from "@reading-studio/server/app"
import { afterEach, expect, it } from "vitest"
import { completeWholeBook, WholeBookAdapter, wholeBookFixture } from "./whole-book-fixture.ts"

const fixtures: Awaited<ReturnType<typeof wholeBookFixture>>[] = []
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close()
})

it("shows semantic attention separately from a completed provider call", async () => {
  // Given
  const fixture = await wholeBookFixture()
  fixtures.push(fixture)
  await completeWholeBook(fixture, new WholeBookAdapter("overstated"))
  const app = createApp({
    reviewStorage: fixture.storage,
    sources: fixture.storage.sources,
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
  // When
  const response = await app.request("http://127.0.0.1:8787/api/study-jobs")
  // Then
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({
    jobs: expect.arrayContaining([
      expect.objectContaining({
        state: "completed",
        semanticSupport: "attention",
        processingStep: "original-verification",
      }),
    ]),
  })
})
