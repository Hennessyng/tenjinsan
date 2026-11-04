import { createHash } from "node:crypto"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { AnalysisRevision, WholeBookPreparation } from "@reading-studio/contracts"
import { afterEach, expect, it } from "vitest"
import { z } from "zod"
import { bookFixtureTurns } from "../../apps/worker/tests/book-map-route-fixture.ts"
import { WholeBookAdapter, wholeBookWorker } from "../../apps/worker/tests/whole-book-fixture.ts"
import { auditRanges } from "./ten29/audit.ts"
import { corpus, formats } from "./ten29/corpus-support.ts"
import { evidenceDirectory } from "./ten29/evidence.ts"
import { persistedCorpus } from "./ten29/persisted-corpus.ts"
import {
  originalRanges,
  processingSnapshot,
  rangeIdentity,
  wirePayload,
} from "./ten29/processing-evidence.ts"

const fixtures: Awaited<ReturnType<typeof persistedCorpus>>[] = []
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close()
})
const cases = corpus.flatMap((family) => formats.map((format) => ({ family, format })))
const evidenceRoot = await evidenceDirectory("processing-run")
const NativeTurn = z.object({
  model: z.string(),
  input: z.array(z.object({ type: z.literal("text"), text: z.string() })),
})

it.each(cases)(
  "persists and mechanically processes $family.id/$format without semantic scoring",
  async ({ family, format }) => {
    // Given: the fixture checks the frozen inventory before persisting or granting.
    const fixture = await persistedCorpus(family, format)
    fixtures.push(fixture)
    const evidence = await mkdtemp(join(evidenceRoot, `${family.id}-${format}-`))
    const save = (name: string, value: unknown) =>
      writeFile(join(evidence, name), JSON.stringify(value, null, 2), { mode: 0o600, flag: "wx" })
    const original = await readFile(fixture.storage.blobs.pathFor(fixture.edition.originalBlobHash))
    expect(createHash("sha256").update(original).digest("hex")).toBe(fixture.edition.originalHash)
    await writeFile(join(evidence, `original.${format}`), original, { mode: 0o600, flag: "wx" })
    const { pipeline, worker, adapter } = wholeBookWorker(fixture, new WholeBookAdapter())
    const initial = pipeline.prepare("setup-whole", "grant-whole")
    const snapshots = [
      {
        boundary: "planned",
        step: 0,
        ...processingSnapshot({ fixture, initial, current: initial, requests: adapter.requests }),
      },
    ]
    expect(initial.wholeBook?.synthesis).toBeNull()
    expect(initial.wholeBook?.maps).toEqual([])
    expect(initial.status).toBe("partial")
    expect(snapshots[0]?.ledger.unsent).toEqual(snapshots[0]?.ledger.planned)
    expect(fixture.storage.sources.getNormalization(fixture.normalization.id)).toEqual(
      fixture.normalization,
    )
    expect(fixture.storage.sources.getEdition(fixture.edition.id)).toEqual(fixture.edition)
    let analysis = initial
    // When
    for (let step = 0; step < 32; step++) {
      if ((await worker.runNext()).kind === "idle") break
      snapshots.push({
        boundary: "terminal-before-map-materialization",
        step: step + 1,
        ...processingSnapshot({ fixture, initial, current: analysis, requests: adapter.requests }),
      })
      analysis = pipeline.prepare("setup-whole", "grant-whole")
      snapshots.push({
        boundary: "materialized",
        step: step + 1,
        ...processingSnapshot({ fixture, initial, current: analysis, requests: adapter.requests }),
      })
    }
    // Then
    const final = snapshots.at(-1)
    if (!final?.ledger || !analysis.wholeBook)
      throw new TypeError("Missing persisted processing evidence")
    expect(analysis.status).toBe("successful")
    expect(analysis.wholeBook.phase).toBe("complete")
    expect(final.ledger.transmitted).toEqual(final.ledger.planned)
    expect(final.ledger.processed).toEqual(final.ledger.planned)
    expect(final.ledger.unsent).toEqual([])
    expect(final.ledger.uncertain).toEqual([])
    expect(final.ledger.pending).toEqual([])
    expect(auditRanges(originalRanges(fixture), final.ledger.processed)).toEqual([])
    expect(Buffer.concat(final.ledger.processed.map((r) => Buffer.from(r.text)))).toEqual(
      Buffer.concat(originalRanges(fixture).map((r) => Buffer.from(r.text))),
    )
    const native = z.array(NativeTurn).parse(bookFixtureTurns(fixture))
    expect(native).toHaveLength(adapter.requests.length)
    expect(final.receipts).toHaveLength(adapter.requests.length)
    for (const [index, turn] of native.entries()) {
      const request = adapter.requests[index]
      const sent = turn.input[0]
      if (!request || !sent) throw new TypeError("Missing native transmission")
      expect(wirePayload(sent.text)).toEqual(wirePayload(request.prompt))
    }
    const data = analysis.wholeBook
    const corruptions = {
      "omitted-map": { ...analysis, wholeBook: { ...data, maps: [] } },
      "dropped-range": {
        ...data,
        parts: data.parts.map((p, i) => (i === 0 ? { ...p, ranges: p.ranges.slice(1) } : p)),
      },
      "duplicate-range": {
        ...data,
        parts: data.parts.map((p, i) =>
          i === 0 ? { ...p, ranges: [...p.ranges, ...p.ranges] } : p,
        ),
      },
    }
    expect(AnalysisRevision.safeParse(corruptions["omitted-map"]).success).toBe(false)
    expect(WholeBookPreparation.safeParse(corruptions["dropped-range"]).success).toBe(false)
    expect(WholeBookPreparation.safeParse(corruptions["duplicate-range"]).success).toBe(false)
    const [first, ...rest] = final.ledger.planned
    if (!first) throw new TypeError("Missing planned source")
    const rangeCorruptions = {
      dropped: rest,
      duplicate: [first, first, ...rest],
      truncated: [{ ...first, end: first.end - 1, text: first.text.slice(0, -1) }, ...rest],
      identity: [{ ...first, blockId: "foreign-block" }, ...rest],
      ...(rest.length ? { reordered: [...rest, first] } : {}),
    }
    const displaced = [
      "identity-or-order",
      "offset-or-duplicate",
      "changed-text-or-unicode",
      "missing-or-truncated",
    ]
    const expectedDiagnosticCodes: Readonly<Record<string, readonly string[]>> = {
      dropped: rest.length ? displaced : ["missing-or-truncated"],
      duplicate: rest.length
        ? ["identity-or-order", "offset-or-duplicate", "changed-text-or-unicode"]
        : ["unexpected-range"],
      truncated: rest.length ? displaced : ["missing-or-truncated"],
      identity: ["identity-or-order"],
      reordered: displaced,
    }
    for (const [fault, ranges] of Object.entries(rangeCorruptions)) {
      const expected = expectedDiagnosticCodes[fault]
      if (!expected) throw new TypeError("Missing intended diagnostic codes")
      expect([...new Set(auditRanges(originalRanges(fixture), ranges))].sort()).toEqual(
        expected.toSorted(),
      )
    }
    await save("source.json", {
      edition: fixture.edition,
      normalization: fixture.normalization,
      setup: fixture.setup,
    })
    await save("snapshots.json", snapshots)
    await save("native-turns.json", native)
    await save("analysis-unscored.json", analysis)
    await save("result.json", {
      family: family.id,
      format,
      originalHash: fixture.edition.originalHash,
      result: "mechanical-pipeline-pass-only",
      semanticScore: "NOT RUN; authored fake responses and verdicts",
      stockSynthesis: data.synthesis?.thesis.map((statement) => statement.text),
      inventoryGate: "unchanged frozen inventory passed before persistence/grant/dispatch",
      pdfGate:
        format === "pdf"
          ? "real production WASM extraction; frozen layout-whitespace comparison only; raw normalized text retained"
          : "not-applicable",
      parserVersion: fixture.normalization.parserVersion,
      normalizerVersion: fixture.normalization.normalizerVersion,
      maps: data.maps.length,
      calls: native.length,
      processingMeaning: "complete persisted map for included text, not proof of understanding",
      planned: final.ledger.planned.length,
      processed: final.ledger.processed.length,
      transmitted: final.ledger.transmitted.length,
      unsent: final.ledger.unsent.length,
      uncertain: final.ledger.uncertain.length,
      pending: final.ledger.pending.length,
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
      utf16: final.ledger.processed.reduce((n, r) => n + r.end - r.start, 0),
      utf8: final.ledger.processed.reduce((n, r) => n + Buffer.byteLength(r.text), 0),
      reconstructedSha256: createHash("sha256")
        .update(Buffer.concat(final.ledger.processed.map((r) => Buffer.from(r.text))))
        .digest("hex"),
      ranges: final.ledger.processed.map(rangeIdentity),
      context: final.ledger.contextTotals,
      corruptionRejections: Object.keys(corruptions),
      rangeDiagnosticDetections: Object.keys(rangeCorruptions),
      rangeReorderApplicability: rest.length
        ? "tested"
        : "single range; cross-range reorder not applicable",
      stages: final.receipts.map((r) => ({
        order: r.order,
        kind: r.kind,
        jobId: r.jobId,
        attemptId: r.attempt.id,
        usage: r.receipt.usage,
      })),
    })
  },
  30000,
)
