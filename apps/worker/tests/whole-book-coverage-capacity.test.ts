import { bookMapRequest, WholeBookContext } from "@reading-studio/generation"
import type { StructuredRequest } from "@reading-studio/providers"
import {
  bookSourcePayload,
  legacyLocalReservationBytes,
  sourceRangesInput,
  structuredRequest,
} from "@reading-studio/providers"
import { afterEach, expect, it } from "vitest"
import { z } from "zod"
import { bookFixtureAuthority, bookFixtureTurns } from "./book-map-route-fixture.ts"
import {
  CoverageAdapter,
  coverageFixture,
  coverageGrantId,
  coverageSetupId,
} from "./whole-book-coverage-fixture.ts"
import { fixtureCapacity, wholeBookFixture, wholeBookWorker } from "./whole-book-fixture.ts"

const fixtures: Awaited<ReturnType<typeof coverageFixture>>[] = []
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close()
})
const Header = z.object({ kind: z.string(), verificationVersion: z.string().optional() })
const payload = (request: StructuredRequest) =>
  z.array(z.unknown()).parse(JSON.parse(request.prompt.slice(request.prompt.lastIndexOf("\n") + 1)))
const isCheck = (request: StructuredRequest) =>
  Header.parse(payload(request)[0]).verificationVersion !== undefined

it("plans the exact selected map envelope that runtime will meter before any reservation", async () => {
  // Given a large signed plan under the existing synthetic byte/token certificate.
  const fixture = await wholeBookFixture("Synthetic bounded source. ".repeat(600), 3)
  try {
    const authority = bookFixtureAuthority(fixture)
    const { pipeline } = wholeBookWorker(fixture)
    pipeline.prepare("setup-whole", "grant-whole")
    const context = new WholeBookContext(authority, "setup-whole", "grant-whole")
    for (const [index, window] of context.scope.windows.entries()) {
      const job = context.job("map", index)
      if (!job) throw new TypeError("Missing planned synthetic map")
      const stage = pipeline.stage(job)
      const planned = bookMapRequest(context.setup, context.normalization, window)
      // When both independent builders serialize the same persisted selected ranges.
      const runtime = structuredRequest({
        model: context.setup.analysis.model,
        settings: context.setup.analysis.settings,
        instruction: stage.instruction,
        blocks: [
          ...(stage.derivedData ?? []),
          ...bookSourcePayload(sourceRangesInput(context.approved, stage.sourceRanges ?? [])),
        ],
        schema: stage.wireSchema ?? z.toJSONSchema(stage.schema, { reused: "ref" }),
        signal: new AbortController().signal,
      })
      // Then the complete schema, instruction, metadata and source payload agree and fit unchanged limits.
      expect(planned.schema).toEqual(runtime.schema)
      expect(planned.prompt).toBe(runtime.prompt)
      expect(legacyLocalReservationBytes("chatgpt-subscription", runtime)).toBeLessThanOrEqual(
        Math.min(32000, fixtureCapacity.maxRequestBytes),
      )
      expect(
        fixtureCapacity.countInputTokens(runtime) + runtime.settings.maxOutputTokens,
      ).toBeLessThanOrEqual(fixtureCapacity.contextTokens)
    }
    expect(fixture.storage.counts().attempts).toBe(0)
  } finally {
    await fixture.close()
  }
})

it("refuses an actual serialized full-window overflow before creating any verification job without changing the approved plan", async () => {
  // Given
  const fixture = await coverageFixture("原".repeat(9000), 1)
  fixtures.push(fixture)
  const before = fixture.storage.sources.getSetup(coverageSetupId)
  const grant = fixture.storage.sources.getGrant(coverageGrantId)
  const run = wholeBookWorker(fixture, new CoverageAdapter())
  let analysis = run.pipeline.prepare(coverageSetupId, coverageGrantId)
  // When
  const advance = async () => {
    for (let step = 0; step < 32 && (await run.worker.runNext()).kind !== "idle"; step++)
      analysis = run.pipeline.prepare(coverageSetupId, coverageGrantId)
  }
  // Then
  await expect(advance()).rejects.toThrow("capacity-limit")
  const windows = analysis.wholeBook?.parts.length ?? 0
  expect(fixture.storage.execution.listSetupJobs(coverageSetupId)).toHaveLength(windows + 1)
  expect(run.adapter.requests.every((request) => !isCheck(request))).toBe(true)
  expect(fixture.storage.sources.getSetup(coverageSetupId)).toEqual(before)
  expect(fixture.storage.sources.getGrant(coverageGrantId)).toEqual(grant)
})

it("measures full actual payloads while verification queue is empty and rechecks before reserving a dispatched attempt", async () => {
  // Given
  const fixture = await coverageFixture()
  fixtures.push(fixture)
  let refuseDispatch = false
  const measured: { readonly request: StructuredRequest; readonly jobs: number }[] = []
  const capacity = {
    ...fixtureCapacity,
    countInputTokens: (request: StructuredRequest) => {
      if (isCheck(request)) {
        measured.push({
          request,
          jobs: fixture.storage.execution.listSetupJobs(coverageSetupId).length,
        })
        if (refuseDispatch) return capacity.contextTokens
      }
      return fixtureCapacity.countInputTokens(request)
    },
  }
  const run = wholeBookWorker(fixture, new CoverageAdapter(), capacity)
  let analysis = run.pipeline.prepare(coverageSetupId, coverageGrantId)
  for (let step = 0; step < 32 && analysis.wholeBook?.phase !== "verifying"; step++) {
    await run.worker.runNext()
    analysis = run.pipeline.prepare(coverageSetupId, coverageGrantId)
  }
  const windows = analysis.wholeBook?.parts.length ?? 0
  const calls = run.adapter.requests.length
  refuseDispatch = true
  // When
  await run.worker.runNext()
  // Then
  expect(measured.filter((entry) => entry.jobs === windows + 1)).toHaveLength(windows + 1)
  expect(measured.some((entry) => entry.jobs === 2 * windows + 2)).toBe(true)
  expect(run.adapter.requests).toHaveLength(calls)
  expect(bookFixtureTurns(fixture)).toHaveLength(calls)
  const failed = fixture.storage.execution
    .listSetupJobs(coverageSetupId)
    .find((job) => job.state === "failed")
  expect(failed).toMatchObject({ error: { code: "capacity-limit" } })
  expect(failed ? fixture.storage.execution.listAttempts(failed.runId) : []).toHaveLength(0)
})
