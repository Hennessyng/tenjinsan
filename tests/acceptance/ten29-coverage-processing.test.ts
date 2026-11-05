import { createHash } from "node:crypto"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { COVERAGE_VERIFICATION_VERSION } from "@reading-studio/contracts"
import { expect, it } from "vitest"
import { bookFixtureTurns } from "../../apps/worker/tests/book-map-route-fixture.ts"
import { WholeBookAdapter, wholeBookWorker } from "../../apps/worker/tests/whole-book-fixture.ts"
import { corpus, formats } from "./ten29/corpus-support.ts"
import { CoverageControlAdapter } from "./ten29/coverage-control-adapter.ts"
import { auditCoveragePath, nativeCoveragePayloads } from "./ten29/coverage-evidence.ts"
import { evidenceDirectory } from "./ten29/evidence.ts"
import { persistedCorpus } from "./ten29/persisted-corpus.ts"
import { processingSnapshot, rangeIdentity } from "./ten29/processing-evidence.ts"

const root = await evidenceDirectory("processing-v3-run")
const cases = corpus.flatMap((family) => formats.map((format) => ({ family, format })))
it.each(cases)(
  "processes version3 $family.id/$format against frozen inventory and full originals, not semantic scores",
  async ({ family, format }) => {
    // Given
    const fixture = await persistedCorpus(family, format, {
      synthesisVersion: COVERAGE_VERIFICATION_VERSION,
    })
    try {
      const directory = await mkdtemp(join(root, `${family.id}-${format}-`))
      const save = (name: string, value: unknown) =>
        writeFile(join(directory, name), JSON.stringify(value, null, 2), {
          flag: "wx",
          mode: 0o600,
        })
      const original = await readFile(
        fixture.storage.blobs.pathFor(fixture.edition.originalBlobHash),
      )
      await writeFile(join(directory, `original.${format}`), original, { flag: "wx", mode: 0o600 })
      const { pipeline, worker, adapter } = wholeBookWorker(
        fixture,
        new CoverageControlAdapter(new WholeBookAdapter()),
      )
      const initial = pipeline.prepare("setup-whole", "grant-whole")
      let analysis = initial
      const snapshots = [
        {
          boundary: "planned",
          step: 0,
          ...processingSnapshot({ fixture, initial, current: initial, requests: adapter.requests }),
        },
      ]
      // When
      for (let step = 0; step < 32; step++) {
        if ((await worker.runNext()).kind === "idle") break
        snapshots.push({
          boundary: "terminal-before-map-materialization",
          step: step + 1,
          ...processingSnapshot({
            fixture,
            initial,
            current: analysis,
            requests: adapter.requests,
          }),
        })
        analysis = pipeline.prepare("setup-whole", "grant-whole")
        snapshots.push({
          boundary: "materialized",
          step: step + 1,
          ...processingSnapshot({
            fixture,
            initial,
            current: analysis,
            requests: adapter.requests,
          }),
        })
      }
      // Then
      const final = snapshots.at(-1)
      if (!final || !analysis.wholeBook) throw new TypeError("Missing current processing artifacts")
      const native = bookFixtureTurns(fixture)
      const coverage = auditCoveragePath({
        analysis,
        normalization: fixture.normalization,
        payloads: nativeCoveragePayloads(native),
      })
      expect(analysis.status).toBe("successful")
      expect(coverage.audit.missingParts).toEqual([])
      expect(final.ledger.processed).toEqual(final.ledger.planned)
      expect(final.ledger.transmitted).toEqual(final.ledger.planned)
      expect(final.ledger.unsent).toEqual([])
      expect(final.ledger.uncertain).toEqual([])
      expect(final.ledger.pending).toEqual([])
      expect(native).toHaveLength(analysis.wholeBook.parts.length * 2 + 2)
      expect(adapter.requests).toHaveLength(native.length)
      await save("source.json", {
        edition: fixture.edition,
        normalization: fixture.normalization,
        setup: fixture.setup,
      })
      await save("snapshots.json", snapshots)
      await save("native-turns.json", native)
      await save("analysis-unscored.json", analysis)
      await save("coverage.json", coverage)
      await save("result.json", {
        family: family.id,
        format,
        originalHash: fixture.edition.originalHash,
        result: "mechanical-pipeline-pass-only",
        semanticScore: "NOT RUN; authored fake responses and verdicts",
        policy: COVERAGE_VERIFICATION_VERSION,
        stockSynthesis: analysis.wholeBook.synthesis?.thesis.map((finding) => finding.text),
        parserVersion: fixture.normalization.parserVersion,
        normalizerVersion: fixture.normalization.normalizerVersion,
        maps: analysis.wholeBook.maps.length,
        calls: native.length,
        ...Object.fromEntries(
          (["planned", "processed", "transmitted", "unsent", "uncertain", "pending"] as const).map(
            (kind) => [kind, final.ledger[kind].length],
          ),
        ),
        accounting: Object.fromEntries(
          (
            [
              "planned",
              "dispatched",
              "transmitted",
              "processed",
              "unsent",
              "uncertain",
              "pending",
            ] as const
          ).map((kind) => [kind, final.ledger[kind].map(rangeIdentity)]),
        ),
        utf16: final.ledger.processed.reduce((sum, range) => sum + range.text.length, 0),
        utf8: final.ledger.processed.reduce((sum, range) => sum + Buffer.byteLength(range.text), 0),
        reconstructedSha256: createHash("sha256")
          .update(Buffer.concat(final.ledger.processed.map((range) => Buffer.from(range.text))))
          .digest("hex"),
        ranges: final.ledger.processed.map(rangeIdentity),
        context: final.ledger.contextTotals,
        meaning: "fresh version3 protocol/source coverage; no semantic validation",
      })
    } finally {
      await fixture.close()
    }
  },
  30000,
)
