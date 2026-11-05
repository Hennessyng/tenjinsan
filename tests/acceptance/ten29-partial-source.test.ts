import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { afterEach, expect, it } from "vitest"
import { WholeBookAdapter, wholeBookWorker } from "../../apps/worker/tests/whole-book-fixture.ts"
import { epubEntries, zipFixture } from "../../packages/ingestion/tests/fixtures.ts"
import { extract } from "./ten29/corpus-support.ts"
import { evidenceDirectory } from "./ten29/evidence.ts"
import { persistedSource } from "./ten29/persisted-source.ts"
import { observedReceipts } from "./ten29/processing-evidence.ts"

const fixtures: Awaited<ReturnType<typeof persistedSource>>[] = []
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close()
})

it("characterizes successful available-text maps while retaining the actual unsupported-source qualifier", async () => {
  // Given: generic synthetic EPUB fixture, not an independently frozen corpus variant.
  const bytes = zipFixture(
    epubEntries.map((entry) =>
      entry.name === "book/chapter.xhtml"
        ? {
            ...entry,
            text: entry.text.replace(
              "</body>",
              "<object>Unavailable synthetic diagram</object></body>",
            ),
          }
        : entry,
    ),
  )
  const extracted = await extract(bytes, "epub")
  const omission = { path: "book/chapter.xhtml", reason: "removed:object" }
  expect(extracted.normalization.coverage).toBe("partial")
  expect(extracted.normalization.omissions).toEqual([omission])
  const fixture = await persistedSource(bytes, extracted)
  fixtures.push(fixture)
  const { pipeline, worker, adapter } = wholeBookWorker(fixture, new WholeBookAdapter())
  const initial = pipeline.prepare("setup-whole", "grant-whole")
  let analysis = initial
  // When
  for (let step = 0; step < 16 && (await worker.runNext()).kind !== "idle"; step++)
    analysis = pipeline.prepare("setup-whole", "grant-whole")
  const stored = fixture.storage.sources.getNormalization(extracted.normalization.id)
  const receipts = observedReceipts(fixture, adapter.requests)
  const evidence = await evidenceDirectory("partial-source")
  await writeFile(
    join(evidence, "result.json"),
    JSON.stringify(
      {
        scope: "generic partial-source characterization, not corpus acceptance",
        initial,
        analysisUnscored: analysis,
        normalization: stored,
        receipts,
        conclusion:
          "complete/successful describes available-text mechanical work only; original completeness and human omission acknowledgement not established; semantic assessment NOT RUN",
      },
      null,
      2,
    ),
    { mode: 0o600, flag: "wx" },
  )
  // Then
  expect(stored).toEqual(extracted.normalization)
  expect(stored?.coverage).toBe("partial")
  expect(stored?.omissions).toEqual([omission])
  const qualifier = "Unavailable, not analyzed: book/chapter.xhtml (removed:object)"
  expect(initial.wholeBook?.limitations).toContain(qualifier)
  expect(analysis.wholeBook?.limitations).toContain(qualifier)
  expect(analysis.status).toBe("successful")
  expect(analysis.wholeBook?.phase).toBe("complete")
  expect(fixture.storage.workflow.getAnalysis(analysis.id)).toEqual(analysis)
  expect(receipts).toHaveLength(4)
  for (const row of receipts)
    expect(row.receipt.inputCoverage).toMatchObject({
      extraction: "partial",
      omissions: [omission],
      processing: "not-established",
    })
})
