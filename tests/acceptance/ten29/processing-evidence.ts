import { type AnalysisRevision, contentDigest } from "@reading-studio/contracts"
import { ProviderReceipt, type StructuredRequest } from "@reading-studio/providers"
import { expect } from "vitest"
import { z } from "zod"
import { bookFixtureTurns } from "../../../apps/worker/tests/book-map-route-fixture.ts"
import type { Range } from "./audit.ts"
import type { persistedCorpus } from "./persisted-corpus.ts"
import { processingAccounting } from "./processing-accounting.ts"

type Fixture = Awaited<ReturnType<typeof persistedCorpus>>
export const WireRange = z.object({
  resourcePath: z.string(),
  blockId: z.string(),
  start: z.number(),
  end: z.number(),
  text: z.string(),
})
export function rangeIdentity({ text, ...identity }: Range) {
  return {
    ...identity,
    utf16Units: text.length,
    utf8Bytes: Buffer.byteLength(text),
    utf8Sha256: contentDigest(text),
  }
}
const Envelope = z.object({
  kind: z.enum(["chapter-map", "book-synthesis", "original-verification"]),
  groupId: z.string().optional(),
})
export function wirePayload(text: string) {
  return z.array(z.unknown()).parse(JSON.parse(text.slice(text.lastIndexOf("\n") + 1)))
}
export function originalRanges(fixture: Fixture): readonly Range[] {
  return fixture.normalization.resources.flatMap((r) =>
    r.status === "included"
      ? r.blocks
          .filter((b) => b.text.length > 0)
          .map((b) => ({
            resourcePath: r.path,
            blockId: b.id,
            start: 0,
            end: b.text.length,
            text: b.text,
          }))
      : [],
  )
}
export function observedReceipts(fixture: Fixture, requests: readonly StructuredRequest[]) {
  const persisted = fixture.storage.execution.listSetupJobs("setup-whole").flatMap((job) =>
    fixture.storage.execution.listAttempts(job.runId).flatMap((attempt) => {
      const body = fixture.storage.execution.getAttemptReceipt(attempt.id)
      return body
        ? [
            {
              jobId: job.id,
              attempt,
              receipt: ProviderReceipt.parse(JSON.parse(new TextDecoder().decode(body))),
            },
          ]
        : []
    }),
  )
  return requests.flatMap((request, order) => {
    const saved = persisted.find(
      (item) => item.receipt.inputCoverage?.requestHash === contentDigest(request.prompt),
    )
    if (!saved) return []
    const payload = wirePayload(request.prompt)
    const envelope = Envelope.parse(payload[0])
    const ranges = z.array(WireRange).parse(payload.slice(1))
    expect(saved.receipt.processingStep).toBe(envelope.kind)
    expect(saved.receipt.inputCoverage?.ranges).toEqual(
      ranges.map(({ resourcePath, blockId, start, end }) => ({
        resourcePath,
        blockId,
        start,
        end,
      })),
    )
    return [{ order, ...saved, kind: envelope.kind, ranges, payload }]
  })
}
function observedMapDispatches(
  fixture: Fixture,
  parts: NonNullable<AnalysisRevision["wholeBook"]>["parts"],
  requests: readonly StructuredRequest[],
) {
  const nativePayloads = bookFixtureTurns(fixture).map((turn) => {
    const parsed = z.object({ input: z.array(z.object({ text: z.string() })) }).parse(turn)
    const text = parsed.input[0]?.text
    if (!text) throw new TypeError("Missing native request payload")
    return JSON.stringify(wirePayload(text))
  })
  const positions = new Map<string, number>()
  const identity = (r: Omit<Range, "text">) => [r.resourcePath, r.blockId, r.start, r.end]
  const observed = requests.flatMap((request, order) => {
    const payload = wirePayload(request.prompt)
    const envelope = Envelope.parse(payload[0])
    if (envelope.kind !== "chapter-map") return []
    const ranges = z.array(WireRange).parse(payload.slice(1))
    const part = parts.find(
      (p) =>
        p.groupId === envelope.groupId &&
        JSON.stringify(p.ranges.map(identity)) === JSON.stringify(ranges.map(identity)),
    )
    const job = part && fixture.storage.execution.getJob(part.id)
    if (!part || !job)
      throw new TypeError("Observed map request has no persisted part/job identity")
    const position = positions.get(part.id) ?? 0
    positions.set(part.id, position + 1)
    const attempt = fixture.storage.execution
      .listAttempts(job.runId)
      .filter((a) => a.state !== "prepared")[position]
    if (!attempt) throw new TypeError("Observed map request has no persisted dispatch attempt")
    return [
      {
        order,
        jobId: job.id,
        partId: part.id,
        partStatus: part.status,
        attempt,
        requestHash: contentDigest(request.prompt),
        ranges,
        nativeObserved: nativePayloads.includes(JSON.stringify(payload)),
      },
    ]
  })
  for (const part of parts) {
    const job = fixture.storage.execution.getJob(part.id)
    if (!job) continue
    for (const attempt of fixture.storage.execution.listAttempts(job.runId))
      if (attempt.state !== "prepared" && !observed.some((row) => row.attempt.id === attempt.id))
        throw new TypeError("Persisted map dispatch lacks observed request identity")
  }
  return observed
}
export function processingSnapshot(input: {
  readonly fixture: Fixture
  readonly initial: AnalysisRevision
  readonly current: AnalysisRevision
  readonly requests: readonly StructuredRequest[]
}) {
  const originals = originalRanges(input.fixture)
  const withText = (r: {
    readonly resourcePath: string
    readonly blockId: string
    readonly start: number
    readonly end: number
  }): Range => {
    const block = originals.find(
      (b) => b.resourcePath === r.resourcePath && b.blockId === r.blockId,
    )
    if (!block) throw new TypeError("Foreign persisted range")
    return { ...r, text: block.text.slice(r.start, r.end) }
  }
  const parts = input.initial.wholeBook?.parts ?? []
  const complete =
    input.current.wholeBook?.maps.filter((map) => map.complete).map((map) => map.partId) ?? []
  const receipts = observedReceipts(input.fixture, input.requests)
  const dispatches = observedMapDispatches(
    input.fixture,
    input.current.wholeBook?.parts ?? [],
    input.requests,
  )
  const uncertain = dispatches.filter(
    (d) => d.attempt.state === "outcome_unknown" || d.attempt.state === "dispatching",
  )
  const ledger = processingAccounting({
    originals,
    planned: parts.flatMap((p) => p.ranges.map(withText)),
    dispatched: dispatches.flatMap((d) => d.ranges),
    transmitted: receipts
      .filter(
        (r) =>
          r.kind === "chapter-map" &&
          dispatches.some((d) => d.attempt.id === r.attempt.id && d.nativeObserved),
      )
      .flatMap((r) => r.ranges),
    processed: parts.filter((p) => complete.includes(p.id)).flatMap((p) => p.ranges.map(withText)),
    uncertain: uncertain.flatMap((d) => d.ranges),
    context: receipts.filter((r) => r.kind !== "chapter-map").flatMap((r) => r.ranges),
  })
  expect(ledger.issues).toEqual([])
  return {
    phase: input.current.wholeBook?.phase,
    ledger,
    jobs: input.fixture.storage.execution.listSetupJobs("setup-whole"),
    receipts,
    dispatches,
  }
}
