import { rmSync } from "node:fs"
import { AnalysisCacheInput, analysisCacheKey, contentDigest } from "@reading-studio/contracts"
import { BookMapPipeline } from "@reading-studio/generation"
import { openStorage } from "@reading-studio/storage"
import { completeGraphFixtures } from "@reading-studio/storage/test-support"
import { afterEach, expect, it } from "vitest"
import { bookMapFixture, FixtureAdapter, fixtureWorker } from "./book-map-fixture.ts"

const fixtures: ReturnType<typeof bookMapFixture>[] = []
afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    fixture.storage.close()
    rmSync(fixture.directory, { recursive: true, force: true })
  }
})

it("resumes bounded chapter jobs after reopening storage and reuses only the exact successful map", async () => {
  // Given
  const fixture = bookMapFixture("Long source. ".repeat(2000))
  fixtures.push(fixture)
  const adapter = new FixtureAdapter()
  const options = () => ({
    storage: fixture.storage,
    ownerId: "owner-1",
    installationId: "installation-1",
  })
  const pipeline = () => new BookMapPipeline(options())
  const worker = () => fixtureWorker(fixture.storage, adapter).worker
  const initial = pipeline().prepare("setup-1", "grant-1")
  await worker().runNext()
  const partial = pipeline().prepare("setup-1", "grant-1")
  fixture.storage.close()
  fixture.storage = openStorage(fixture)
  // When
  while ((await worker().runNext()).kind !== "idle") {}
  const completed = pipeline().prepare("setup-1", "grant-1")
  const reused = pipeline().prepare("setup-1", "grant-1")
  // Then
  expect(initial.status).toBe("partial")
  expect(partial.status).toBe("partial")
  expect(completed.status).toBe("successful")
  expect(completed.chapters).toHaveLength(2)
  expect(completed.chapters.every((chapter) => chapter.status === "complete")).toBe(true)
  expect(completed.qualifications).toHaveLength(4)
  expect(reused.id).toBe(completed.id)
  expect(adapter.requests).toHaveLength(4)
  expect(adapter.requests.every((request) => request.prompt.length < 14000)).toBe(true)
  expect(fixture.storage.workflow.getAnalysis(initial.id)).toEqual(initial)
  const source = completed.claims[0]?.sources[0]
  if (!source) throw new TypeError("Missing mapped source")
  expect(() => fixture.storage.sources.appendSpan(source)).not.toThrow()
})

it("shares the 64-call ceiling across a setup's chapter windows", async () => {
  const fixture = bookMapFixture("A source sentence. ".repeat(5_000), 9)
  fixtures.push(fixture)
  const adapter = new FixtureAdapter()
  const { pipeline, worker } = fixtureWorker(fixture.storage, adapter)
  pipeline.prepare("setup-1", "grant-1")
  while ((await worker.runNext()).kind !== "idle") {}
  expect(adapter.requests.length).toBeLessThanOrEqual(64)
  expect(pipeline.prepare("setup-1", "grant-1").status).toBe("partial")
})

it("requires new consent and never passes cached findings to the other provider", async () => {
  // Given
  const fixture = bookMapFixture()
  fixtures.push(fixture)
  const adapter = new FixtureAdapter()
  const { pipeline, worker } = fixtureWorker(fixture.storage, adapter)
  pipeline.prepare("setup-1", "grant-1")
  while ((await worker.runNext()).kind !== "idle") {}
  const first = pipeline.prepare("setup-1", "grant-1")
  const downstream = completeGraphFixtures()
  const question = { ...downstream.question, analysisRevisionId: first.id }
  fixture.storage.workflow.appendQuestion({ record: question, parentRevisionId: null })
  fixture.storage.workflow.appendAnswer({
    id: "answer-pinned",
    studyId: "study-1",
    parentRevisionId: null,
    submission: { question, answer: downstream.submission.answer },
  })
  const setup = fixture.storage.sources.getSetup("setup-1")
  const grant = fixture.storage.sources.getGrant("grant-1")
  if (!setup || !grant) throw new TypeError("Missing fixture setup")
  fixture.storage.sources.appendSetup({
    record: {
      ...setup,
      id: "setup-2",
      analysis: { ...setup.analysis, provider: "anthropic", model: "claude-sonnet-4-6" },
    },
    parentRevisionId: setup.id,
  })
  expect(() => pipeline.prepare("setup-2", "grant-1")).toThrow()
  fixture.storage.sources.appendGrant({ ...grant, id: "grant-2", setupRevisionId: "setup-2" })
  // When
  const pending = pipeline.prepare("setup-2", "grant-2")
  while ((await worker.runNext()).kind !== "idle") {}
  const second = pipeline.prepare("setup-2", "grant-2")
  // Then
  expect(pending.status).toBe("partial")
  expect(second.status).toBe("successful")
  expect(second.id).not.toBe(first.id)
  expect(adapter.requests).toHaveLength(4)
  expect(adapter.requests.slice(2).map((request) => request.model)).toEqual([
    "claude-sonnet-4-6",
    "claude-sonnet-4-6",
  ])
  for (const request of adapter.requests.slice(2)) {
    const payload: unknown = JSON.parse(request.prompt.slice(request.prompt.lastIndexOf("\n") + 1))
    expect(payload).toEqual([
      {
        blockId: expect.any(String),
        resourcePath: expect.any(String),
        text: expect.any(String),
        start: 0,
        end: expect.any(Number),
      },
    ])
  }
  expect(fixture.storage.workflow.getAnalysis(first.id)).toEqual(first)
  expect(fixture.storage.workflow.getAnswer("answer-pinned")?.question.analysisRevisionId).toBe(
    first.id,
  )
  expect(() =>
    fixture.storage.workflow.appendAnalysis({
      record: { ...first, claims: [] },
      parentRevisionId: null,
    }),
  ).toThrow()
})

it("creates a distinct map for a newly approved partial source scope", async () => {
  // Given
  const fixture = bookMapFixture()
  fixtures.push(fixture)
  const adapter = new FixtureAdapter()
  const { pipeline, worker } = fixtureWorker(fixture.storage, adapter)
  pipeline.prepare("setup-1", "grant-1")
  while ((await worker.runNext()).kind !== "idle") {}
  const first = pipeline.prepare("setup-1", "grant-1")
  const setup = fixture.storage.sources.getSetup("setup-1")
  const grant = fixture.storage.sources.getGrant("grant-1")
  if (!setup || !grant) throw new TypeError("Missing fixture setup")
  fixture.storage.sources.appendSetup({
    record: {
      ...setup,
      id: "setup-partial",
      analysis: {
        ...setup.analysis,
        scope: {
          kind: "partial",
          selected: setup.analysis.scope.selected.slice(0, 1),
          exclusions: setup.analysis.scope.selected.slice(1),
        },
      },
    },
    parentRevisionId: setup.id,
  })
  fixture.storage.sources.appendGrant({
    ...grant,
    id: "grant-partial",
    setupRevisionId: "setup-partial",
  })
  // When
  pipeline.prepare("setup-partial", "grant-partial")
  while ((await worker.runNext()).kind !== "idle") {}
  const partialScope = pipeline.prepare("setup-partial", "grant-partial")
  // Then
  expect(partialScope.status).toBe("successful")
  expect(partialScope.id).not.toBe(first.id)
  expect(partialScope.chapters).toHaveLength(1)
  expect(adapter.requests).toHaveLength(3)
  expect(fixture.storage.workflow.getAnalysis(first.id)?.chapters).toHaveLength(2)
})

for (const fault of ["refused", "invalid-citation"] as const) {
  it(`keeps the approved chapter visible when a fixture returns ${fault}`, async () => {
    // Given
    const fixture = bookMapFixture()
    fixtures.push(fixture)
    const { pipeline, worker } = fixtureWorker(fixture.storage, new FixtureAdapter(fault))
    pipeline.prepare("setup-1", "grant-1")
    await fixtureWorker(fixture.storage, new FixtureAdapter()).worker.runNext()
    // When
    const outcome = await worker.runNext()
    const partial = pipeline.prepare("setup-1", "grant-1")
    // Then
    expect(outcome.kind).toBe("provider")
    if (outcome.kind !== "provider") throw new TypeError("Expected provider outcome")
    expect(outcome.job.state).toBe("failed")
    expect(partial.status).toBe("partial")
    expect(partial.chapters).toHaveLength(2)
    expect(partial.chapters.map((chapter) => chapter.status)).toEqual(["complete", "pending"])
    expect(fixture.storage.workflow.findSuccessfulAnalysis(partial.cacheKey)).toBeNull()
  })
}

it("misses successful cache entries when any analysis identity field changes", async () => {
  // Given
  const fixture = bookMapFixture()
  fixtures.push(fixture)
  const { pipeline, worker } = fixtureWorker(fixture.storage, new FixtureAdapter())
  pipeline.prepare("setup-1", "grant-1")
  while ((await worker.runNext()).kind !== "idle") {}
  const result = pipeline.prepare("setup-1", "grant-1")
  const input = result.cacheInput
  const variants = [
    { editionHash: contentDigest("another edition") },
    { normalizationRevisionId: "normalization-2" },
    {
      scope: {
        kind: "partial",
        selected: input.scope.selected.slice(0, 1),
        exclusions: input.scope.selected.slice(1),
      },
    },
    { provider: "anthropic" },
    { model: "different-model" },
    { analysisPromptVersion: "analysis-2" },
    { analysisSchemaVersion: "analysis-2" },
    ...Object.entries({
      temperature: 1,
      topP: 0.5,
      maxOutputTokens: 500,
      seed: 42,
      reasoningEffort: "high",
    }).map(([key, value]) => ({ settings: { ...input.settings, [key]: value } })),
  ]
  // When
  const misses = variants.map((variant) =>
    fixture.storage.workflow.findSuccessfulAnalysis(
      analysisCacheKey(AnalysisCacheInput.parse({ ...input, ...variant })),
    ),
  )
  // Then
  expect(misses).toEqual(variants.map(() => null))
  expect(fixture.storage.workflow.findSuccessfulAnalysis(result.cacheKey)?.id).toBe(result.id)
})
