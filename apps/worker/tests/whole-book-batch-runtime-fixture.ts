import { ChapterPartMap, StudySetupRevision } from "@reading-studio/contracts"
import { approveBatchedVerification, SynthesisOutput } from "@reading-studio/generation"
import type { ProviderReceipt, StructuredRequest } from "@reading-studio/providers"
import { z } from "zod"
import { batchingFixture } from "./whole-book-batching-fixture.ts"
import { WholeBookAdapter, wholeBookWorker } from "./whole-book-fixture.ts"

export async function batchRuntimeFixture(maxFindingBatches = 4, createGrant = true) {
  const item = await batchingFixture()
  const result = approveBatchedVerification(item.execution, item.windows, {
    maxFindingBatches,
    cap: 64,
    used: 0,
  })
  if (result.kind !== "ready") throw new TypeError("Missing approved reserve")
  const setup = item.fixture.storage.sources.appendSetup({
    record: StudySetupRevision.parse({
      ...item.execution.setup,
      batchedVerificationReserve: result.reserve,
      analysis: {
        ...item.execution.setup.analysis,
        processing: {
          ...item.execution.setup.analysis.processing,
          batchReserveId: result.reserve.id,
        },
      },
    }),
    parentRevisionId: "setup-whole",
  })
  const oldGrant = item.fixture.storage.sources.getGrant("grant-whole")
  if (!oldGrant) throw new TypeError("Missing fixture grant")
  const proposal = { ...oldGrant, id: "grant-batch4", setupRevisionId: setup.id }
  const grant = createGrant ? item.fixture.storage.sources.appendGrant(proposal) : proposal
  return { ...item, setup, grant, reserve: result.reserve }
}
export class BatchedRuntimeAdapter extends WholeBookAdapter {
  constructor(
    readonly localVerdict: "not-addressed" | "contradicted" = "not-addressed",
    readonly globalFindingCount = 6,
  ) {
    super()
  }
  override async dispatch(request: StructuredRequest): Promise<ProviderReceipt> {
    const payload = z
      .array(z.unknown())
      .parse(JSON.parse(request.prompt.slice(request.prompt.lastIndexOf("\n") + 1)))
    const header = z.object({ kind: z.string() }).parse(payload[0])
    if (header.kind === "batched-original-verification") {
      this.requests.push(request)
      const input = z
        .object({ task: z.string(), interpretations: z.array(z.object({ id: z.string() })) })
        .parse(payload[0])
      return {
        kind: "output",
        text: JSON.stringify({
          decisions: input.interpretations.map((finding) => ({
            id: finding.id,
            verdict: input.task === "window-findings" ? this.localVerdict : "supported",
            explanation: "Authored batch-state control, not semantic judgment",
          })),
          mapCoverage:
            input.task === "map-omission"
              ? { verdict: "none", explanation: "Authored omission state", sources: [] }
              : null,
        }),
        usage: { kind: "known", inputTokens: 10, outputTokens: 10 },
      }
    }
    const output = await super.dispatch(request)
    if (header.kind !== "book-synthesis") return output
    const maps = z.object({ maps: z.array(ChapterPartMap) }).parse(payload[0]).maps
    const span = maps[0]?.summary.sources[0]
    if (!span) throw new TypeError("Missing synthesis source")
    const citation = {
      resourcePath: span.resourcePath,
      blockId: span.blockId,
      start: span.start,
      end: span.end,
    }
    return {
      ...output,
      kind: "output",
      text: JSON.stringify(
        SynthesisOutput.parse({
          complete: true,
          representedGroupIds: [...new Set(maps.map((map) => map.groupId))],
          thesis: [{ text: "a".repeat(1600), citations: [citation] }],
          progression: Array.from({ length: this.globalFindingCount - 1 }, (_, index) => ({
            text: String(index % 10).repeat(1600),
            citations: [citation],
          })),
          connections: [],
          conflicts: [],
          changesOfPosition: [],
          uncertainties: [],
        }),
      ),
    }
  }
}
export async function finishBatchRuntime(
  item: Awaited<ReturnType<typeof batchRuntimeFixture>>,
  adapter = new BatchedRuntimeAdapter(),
) {
  const run = wholeBookWorker(item.fixture, adapter, item.execution.capacity)
  let analysis = run.pipeline.prepare(item.setup.id, item.grant.id)
  for (let step = 0; step < 64; step++) {
    if ((await run.worker.runNext()).kind === "idle") break
    analysis = run.pipeline.prepare(item.setup.id, item.grant.id)
  }
  return { ...run, adapter, analysis }
}
export async function batchAtVerification(
  item: Awaited<ReturnType<typeof batchRuntimeFixture>>,
  adapter = new BatchedRuntimeAdapter(),
) {
  const run = wholeBookWorker(item.fixture, adapter, item.execution.capacity)
  let analysis = run.pipeline.prepare(item.setup.id, item.grant.id)
  for (let step = 0; step < 16 && analysis.wholeBook?.phase !== "verifying"; step++) {
    await run.worker.runNext()
    analysis = run.pipeline.prepare(item.setup.id, item.grant.id)
  }
  if (analysis.wholeBook?.phase !== "verifying")
    throw new TypeError("Batch fixture did not reach verification")
  return { ...run, adapter, analysis }
}
