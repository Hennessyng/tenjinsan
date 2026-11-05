import { analysisCacheKey } from "@reading-studio/contracts"
import { afterEach, expect, it } from "vitest"
import { completeWholeBook, wholeBookFixture } from "./whole-book-fixture.ts"

const fixtures: Awaited<ReturnType<typeof wholeBookFixture>>[] = []
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close()
})

it("does not reuse cached analysis after the processing version changes", async () => {
  // Given
  const fixture = await wholeBookFixture()
  fixtures.push(fixture)
  const { analysis, pipeline } = await completeWholeBook(fixture)
  const setup = fixture.storage.sources.getSetup("setup-whole")
  const grant = fixture.storage.sources.getGrant("grant-whole")
  if (!setup || !grant || !setup.analysis.processing) throw new TypeError("Missing synthetic setup")
  const changed = fixture.storage.sources.appendSetup({
    record: {
      ...setup,
      id: "new-version",
      analysis: {
        ...setup.analysis,
        processing: { ...setup.analysis.processing, synthesisVersion: "unsupported-synthesis" },
      },
    },
    parentRevisionId: setup.id,
  })
  fixture.storage.sources.appendGrant({ ...grant, id: "new-grant", setupRevisionId: changed.id })
  const jobs = fixture.storage.execution.listOwnerJobs("owner-1")
  // When / Then
  expect(analysisCacheKey(changed.analysis)).not.toBe(analysis.cacheKey)
  expect(() => pipeline.prepare(changed.id, "new-grant")).toThrow("unsupported-version")
  expect(fixture.storage.execution.listOwnerJobs("owner-1")).toEqual(jobs)
  expect(fixture.storage.workflow.getAnalysis(analysis.id)).toEqual(analysis)
})
