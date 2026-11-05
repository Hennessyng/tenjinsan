import { openStorage } from "@reading-studio/storage"
import { afterEach, expect, it } from "vitest"
import { bookFixtureTurns, closeBookRoute } from "./book-map-route-fixture.ts"
import {
  CoverageAdapter,
  coverageFixture,
  coverageGrantId,
  coverageSetupId,
  finishCoverage,
} from "./whole-book-coverage-fixture.ts"
import { wholeBookWorker } from "./whole-book-fixture.ts"

const fixtures: Awaited<ReturnType<typeof coverageFixture>>[] = []
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close()
})

it("resumes version3 after a persisted map and reuses its exact successful cache without repeated native calls", async () => {
  // Given
  const fixture = await coverageFixture()
  fixtures.push(fixture)
  const adapter = new CoverageAdapter()
  const run = wholeBookWorker(fixture, adapter)
  const setup = fixture.storage.sources.getSetup(coverageSetupId)
  const grant = fixture.storage.sources.getGrant(coverageGrantId)
  run.pipeline.prepare(coverageSetupId, coverageGrantId)
  await run.worker.runNext()
  const partial = run.pipeline.prepare(coverageSetupId, coverageGrantId)
  const completed = fixture.storage.execution
    .listSetupJobs(coverageSetupId)
    .filter((job) => job.state === "completed")
    .map((job) => job.id)
  expect(partial.wholeBook?.maps).toHaveLength(1)
  expect(bookFixtureTurns(fixture)).toHaveLength(1)
  await closeBookRoute(fixture.storage)
  fixture.storage.close()
  fixture.storage = openStorage(fixture)
  // When
  const result = await finishCoverage(fixture, adapter)
  const cached = result.pipeline.prepare(coverageSetupId, coverageGrantId)
  // Then
  expect(result.analysis.status).toBe("successful")
  expect(cached).toEqual(result.analysis)
  expect(bookFixtureTurns(fixture)).toHaveLength(8)
  expect(adapter.requests).toHaveLength(8)
  const jobs = fixture.storage.execution.listSetupJobs(coverageSetupId)
  expect(jobs).toHaveLength(8)
  expect(
    jobs.filter((job) => completed.includes(job.id)).every((job) => job.state === "completed"),
  ).toBe(true)
  expect(jobs.flatMap((job) => fixture.storage.execution.listAttempts(job.runId))).toHaveLength(8)
  expect(fixture.storage.sources.getSetup(coverageSetupId)).toEqual(setup)
  expect(fixture.storage.sources.getGrant(coverageGrantId)).toEqual(grant)
})
