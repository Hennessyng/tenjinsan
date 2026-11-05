import {
  analysisCacheKey,
  COVERAGE_VERIFICATION_VERSION,
  coverageTargetHash,
} from "@reading-studio/contracts"
import { ProviderReceipt } from "@reading-studio/providers"
import { afterEach, expect, it } from "vitest"
import { z } from "zod"
import { bookFixtureTurns } from "./book-map-route-fixture.ts"
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

it("preserves a planned whitespace-only block rather than treating full-window originals as finding quotations", async () => {
  // Given
  const fixture = await coverageFixture(" \t \n", 1)
  fixtures.push(fixture)
  // When
  const { analysis } = await finishCoverage(fixture)
  // Then
  expect(analysis.status).toBe("successful")
  expect(
    analysis.wholeBook?.verification.some(
      (check) =>
        check.coverage?.target.kind === "window" &&
        check.coverage.target.originals.some((span) => span.originalFragment === " \t \n"),
    ),
  ).toBe(true)
})

it("completes the revised policy with all planned windows and exactly the existing W+1 verification jobs", async () => {
  // Given
  const fixture = await coverageFixture()
  fixtures.push(fixture)
  const windows =
    fixture.storage.sources.getSetup(coverageSetupId)?.analysis.processing?.plan?.length ?? 0
  // When
  const { analysis, adapter } = await finishCoverage(fixture)
  // Then
  expect(analysis.status).toBe("successful")
  expect(analysis.wholeBook?.synthesisVersion).toBe(COVERAGE_VERIFICATION_VERSION)
  expect(windows).toBe(3)
  expect(analysis.wholeBook?.parts).toHaveLength(windows)
  expect(analysis.wholeBook?.verification).toHaveLength(windows + 1)
  const jobs = fixture.storage.execution.listSetupJobs(coverageSetupId)
  expect(jobs).toHaveLength(2 * windows + 2)
  expect(jobs.every((job) => job.state === "completed")).toBe(true)
  expect(jobs.flatMap((job) => fixture.storage.execution.listAttempts(job.runId))).toHaveLength(
    2 * windows + 2,
  )
  expect(adapter.requests).toHaveLength(2 * windows + 2)
  expect(bookFixtureTurns(fixture)).toHaveLength(2 * windows + 2)
  for (const check of analysis.wholeBook?.verification ?? []) {
    const job = jobs.find((job) => job.id === check.id)
    const attempt = job ? fixture.storage.execution.listAttempts(job.runId).at(-1) : null
    const body = attempt ? fixture.storage.execution.getAttemptReceipt(attempt.id) : null
    if (!body) throw new TypeError("Missing actual verification receipt")
    const receipt = ProviderReceipt.parse(JSON.parse(new TextDecoder().decode(body)))
    if (!receipt.verificationTarget) throw new TypeError("Missing received target binding")
    expect(coverageTargetHash(receipt.verificationTarget)).toBe(check.targetHash)
  }
  const native = z
    .array(z.object({ input: z.array(z.object({ text: z.string() })) }))
    .parse(bookFixtureTurns(fixture))
  const payloads = native.map((turn) => {
    const text = turn.input[0]?.text
    if (!text) throw new TypeError("Missing native input")
    return z.array(z.unknown()).parse(JSON.parse(text.slice(text.lastIndexOf("\n") + 1)))
  })
  const normalization = fixture.storage.sources.getNormalization(
    analysis.cacheInput.normalizationRevisionId,
  )
  for (const check of analysis.wholeBook?.verification ?? []) {
    const target = check.coverage?.target
    if (target?.kind !== "window") continue
    const wire = payloads.find(
      (payload) =>
        z.object({ targetHash: z.string().optional() }).parse(payload[0]).targetHash ===
        check.targetHash,
    )
    if (!wire) throw new TypeError("Missing native window check")
    const part = analysis.wholeBook?.parts.find((part) => part.id === target.map.partId)
    const expected = part?.ranges.map((range) => {
      const resource = normalization?.resources.find(
        (resource) => resource.path === range.resourcePath,
      )
      const block =
        resource?.status === "included"
          ? resource.blocks.find((block) => block.id === range.blockId)
          : null
      if (!block) throw new TypeError("Missing authoritative original")
      return { ...range, text: block.text.slice(range.start, range.end) }
    })
    expect(
      z
        .array(
          z.object({
            resourcePath: z.string(),
            blockId: z.string(),
            start: z.number(),
            end: z.number(),
            text: z.string(),
          }),
        )
        .parse(wire.slice(1)),
    ).toEqual(expected)
  }
})

it.each(["material-omission", "contradicted", "qualifies", "uncertain"] as const)(
  "blocks actual preparation for scripted %s outcomes",
  async (mode) => {
    // Given
    const fixture = await coverageFixture()
    fixtures.push(fixture)
    // When
    const { analysis } = await finishCoverage(fixture, new CoverageAdapter(mode))
    // Then
    expect(analysis.status).toBe("partial")
    expect(analysis.wholeBook?.phase).toBe("blocked")
    expect(fixture.storage.workflow.findSuccessfulAnalysis(analysis.cacheKey)).toBeNull()
  },
)

it("uses a distinct cache key and leaves the superseded grant and its setup unchanged", async () => {
  // Given
  const fixture = await coverageFixture()
  fixtures.push(fixture)
  const old = fixture.storage.sources.getSetup("setup-whole")
  const priorGrant = fixture.storage.sources.getGrant("grant-whole")
  if (!old) throw new TypeError("Missing old setup")
  // When
  const { analysis, pipeline } = await finishCoverage(fixture)
  // Then
  expect(analysis.cacheKey).not.toBe(analysisCacheKey(old.analysis))
  const processing = analysis.cacheInput.processing
  if (!processing) throw new TypeError("Missing processing identity")
  expect(
    analysisCacheKey({
      ...analysis.cacheInput,
      processing: { ...processing, synthesisVersion: "maps-original-check-2" },
    }),
  ).not.toBe(analysis.cacheKey)
  expect(fixture.storage.sources.getSetup(old.id)).toEqual(old)
  expect(fixture.storage.sources.getGrant("grant-whole")).toEqual(priorGrant)
  expect(() => pipeline.prepare(old.id, "grant-whole")).toThrow("unauthorized")
})
