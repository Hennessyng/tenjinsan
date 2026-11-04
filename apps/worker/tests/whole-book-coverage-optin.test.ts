import {
  analysisCacheKey,
  contentDigest,
  EXPERIMENTAL_COVERAGE_OPT_IN_VERSION,
  Job,
  RunBudget,
  StudySetupRevision,
} from "@reading-studio/contracts"
import { wholeBookFeasibility } from "@reading-studio/generation"
import { afterEach, expect, it } from "vitest"
import { bookFixtureCapacity, bookFixtureTurns } from "./book-map-route-fixture.ts"
import {
  coverageFixture,
  coverageGrantId,
  coverageSetupId,
  finishCoverage,
} from "./whole-book-coverage-fixture.ts"
import { wholeBookFixture, wholeBookWorker } from "./whole-book-fixture.ts"

const fixtures: Awaited<ReturnType<typeof coverageFixture>>[] = []
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close()
})

it("refuses an already granted interim unmarked v3 setup before first enqueue or native attempt", async () => {
  // Given
  const fixture = await coverageFixture(undefined, 2, false)
  fixtures.push(fixture)
  const setup = fixture.storage.sources.getSetup(coverageSetupId)
  const grant = fixture.storage.sources.getGrant(coverageGrantId)
  const run = wholeBookWorker(fixture)
  const normalization =
    setup && fixture.storage.sources.getNormalization(setup.analysis.normalizationRevisionId)
  if (!setup || !normalization) throw new TypeError("Missing granted inputs")
  const transientOnly = await wholeBookFeasibility({
    setup,
    normalization,
    capacity: bookFixtureCapacity,
    cap: 64,
    used: 0,
    allowExperimentalCoverage: true,
  })
  expect(transientOnly.kind).toBe("limited")
  // When / Then
  expect(() => run.pipeline.prepare(coverageSetupId, coverageGrantId)).toThrow(
    "route-re-review-required",
  )
  expect(fixture.storage.counts()).toMatchObject({ jobs: 0, attempts: 0, runs: 0 })
  expect(bookFixtureTurns(fixture)).toHaveLength(0)
  expect(fixture.storage.sources.getSetup(coverageSetupId)).toEqual(setup)
  expect(fixture.storage.sources.getGrant(coverageGrantId)).toEqual(grant)
})

it("does not return a compatible cached success to an unmarked granted v3 revision", async () => {
  // Given
  const fixture = await coverageFixture()
  fixtures.push(fixture)
  const { analysis, pipeline } = await finishCoverage(fixture)
  const setup = fixture.storage.sources.getSetup(coverageSetupId)
  const grant = fixture.storage.sources.getGrant(coverageGrantId)
  if (!setup || !grant) throw new TypeError("Missing trusted fixture")
  const unmarked = Object.fromEntries(
    Object.entries(setup).filter(([key]) => key !== "experimentalCoverageOptIn"),
  )
  const interim = fixture.storage.sources.appendSetup({
    record: { ...unmarked, id: "setup-interim" },
    parentRevisionId: setup.id,
  })
  fixture.storage.sources.appendGrant({
    ...grant,
    id: "grant-interim",
    setupRevisionId: interim.id,
  })
  const before = fixture.storage.counts(),
    turns = bookFixtureTurns(fixture)
  // When / Then
  expect(() => pipeline.prepare(interim.id, "grant-interim")).toThrow("route-re-review-required")
  expect(fixture.storage.counts()).toEqual(before)
  expect(bookFixtureTurns(fixture)).toEqual(turns)
  expect(fixture.storage.workflow.getAnalysis(analysis.id)).toEqual(analysis)
})

it("refuses a false marker and cannot mutate the already granted setup into an opted-in one", async () => {
  // Given
  const fixture = await coverageFixture(undefined, 2, false)
  fixtures.push(fixture)
  const setup = fixture.storage.sources.getSetup(coverageSetupId),
    grant = fixture.storage.sources.getGrant(coverageGrantId)
  if (!setup || !grant) throw new TypeError("Missing interim grant")
  const disabled = fixture.storage.sources.appendSetup({
    record: {
      ...setup,
      id: "setup-disabled",
      experimentalCoverageOptIn: { version: EXPERIMENTAL_COVERAGE_OPT_IN_VERSION, enabled: false },
    },
    parentRevisionId: setup.id,
  })
  fixture.storage.sources.appendGrant({
    ...grant,
    id: "grant-disabled",
    setupRevisionId: disabled.id,
  })
  const run = wholeBookWorker(fixture)
  // When / Then
  expect(() => run.pipeline.prepare(disabled.id, "grant-disabled")).toThrow(
    "route-re-review-required",
  )
  expect(() =>
    fixture.storage.sources.appendSetup({
      record: {
        ...disabled,
        experimentalCoverageOptIn: { version: EXPERIMENTAL_COVERAGE_OPT_IN_VERSION, enabled: true },
      },
      parentRevisionId: setup.id,
    }),
  ).toThrow()
  expect(fixture.storage.sources.getSetup(disabled.id)).toEqual(disabled)
  expect(fixture.storage.sources.getSetup(setup.id)).toEqual(setup)
  expect(fixture.storage.sources.getGrant(grant.id)).toEqual(grant)
  expect(fixture.storage.counts()).toMatchObject({ jobs: 0, attempts: 0, runs: 0 })
  expect(bookFixtureTurns(fixture)).toHaveLength(0)
})

it("fences a simulated already-queued interim v3 map before reserving an attempt", async () => {
  // Given: only this disposable synthetic database is seeded, never owner state.
  const fixture = await coverageFixture(undefined, 2, false)
  fixtures.push(fixture)
  const setup = fixture.storage.sources.getSetup(coverageSetupId),
    grant = fixture.storage.sources.getGrant(coverageGrantId)
  if (!setup || !grant) throw new TypeError("Missing interim setup")
  const id = `wb-${contentDigest(JSON.stringify([setup.id, grant.id, analysisCacheKey(setup.analysis), "map", 0]))}`
  const inputRevisionId = fixture.storage.workflow.ensureAnalysisInput(setup.id)
  fixture.storage.execution.appendRun({
    id,
    inputRevisionId,
    budget: RunBudget.parse({ maxCalls: 2 }),
    reservedCalls: 0,
    state: "running",
  })
  fixture.storage.execution.appendJob(
    Job.parse({
      id,
      runId: id,
      inputRevisionId,
      setupRevisionId: setup.id,
      provider: setup.analysis.provider,
      model: setup.analysis.model,
      promptVersion: setup.analysis.analysisPromptVersion,
      schemaVersion: setup.analysis.analysisSchemaVersion,
      grant,
      stage: "analysis",
      checkpoint: null,
      cancellationRequested: false,
      usage: { kind: "known", inputTokens: 0, outputTokens: 0 },
      state: "queued",
    }),
  )
  // When
  await wholeBookWorker(fixture).worker.runNext()
  // Then
  expect(fixture.storage.execution.listAttempts(id)).toHaveLength(0)
  expect(bookFixtureTurns(fixture)).toHaveLength(0)
  expect(fixture.storage.execution.getJob(id)).toMatchObject({
    state: "failed",
    error: { code: "route-re-review-required" },
  })
})

it("defaults marker absence/omitted enabled to disabled, rejects invalid marker data and leaves v2 cache identity unchanged", async () => {
  // Given
  const fixture = await wholeBookFixture()
  fixtures.push(fixture)
  const setup = fixture.storage.sources.getSetup("setup-whole")
  if (!setup) throw new TypeError("Missing v2 setup")
  // When
  const legacy = StudySetupRevision.parse(JSON.parse(JSON.stringify(setup)))
  const disabled = StudySetupRevision.parse({
    ...setup,
    experimentalCoverageOptIn: { version: EXPERIMENTAL_COVERAGE_OPT_IN_VERSION },
  })
  const marked = StudySetupRevision.parse({
    ...setup,
    experimentalCoverageOptIn: { version: EXPERIMENTAL_COVERAGE_OPT_IN_VERSION, enabled: true },
  })
  // Then
  expect(Object.hasOwn(legacy, "experimentalCoverageOptIn")).toBe(false)
  expect(disabled.experimentalCoverageOptIn?.enabled).toBe(false)
  expect(
    StudySetupRevision.safeParse({
      ...setup,
      experimentalCoverageOptIn: { version: "unknown", enabled: true },
    }).success,
  ).toBe(false)
  expect(
    StudySetupRevision.safeParse({
      ...setup,
      experimentalCoverageOptIn: { version: EXPERIMENTAL_COVERAGE_OPT_IN_VERSION, enabled: "true" },
    }).success,
  ).toBe(false)
  expect(analysisCacheKey(marked.analysis)).toBe(analysisCacheKey(legacy.analysis))
  expect(fixture.storage.sources.getSetup(setup.id)).toEqual(setup)
})
