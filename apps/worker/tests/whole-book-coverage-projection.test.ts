import { createApp } from "@reading-studio/server/app"
import { afterEach, expect, it } from "vitest"
import { z } from "zod"
import {
  CoverageAdapter,
  coverageFixture,
  coverageSetupId,
  finishCoverage,
} from "./whole-book-coverage-fixture.ts"

const fixtures: Awaited<ReturnType<typeof coverageFixture>>[] = []
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close()
})

it.each(["not-addressed", "material-omission"] as const)(
  "projects the actual scoped %s result rather than a completed provider call",
  async (mode) => {
    // Given
    const fixture = await coverageFixture()
    fixtures.push(fixture)
    const { analysis } = await finishCoverage(fixture, new CoverageAdapter(mode))
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
    const jobs = z
      .object({
        jobs: z.array(
          z.object({
            setupRevisionId: z.string(),
            processingStep: z.string().optional(),
            semanticSupport: z.string().optional(),
          }),
        ),
      })
      .parse(await response.json())
      .jobs.filter(
        (job) =>
          job.setupRevisionId === coverageSetupId && job.processingStep === "original-verification",
      )
    // Then
    expect(jobs).toHaveLength((analysis.wholeBook?.parts.length ?? 0) + 1)
    expect(jobs.filter((job) => job.semanticSupport === "attention")).toHaveLength(
      mode === "material-omission" ? (analysis.wholeBook?.parts.length ?? 0) : 0,
    )
    expect(jobs.filter((job) => job.semanticSupport === "not-established")).toHaveLength(0)
  },
)
