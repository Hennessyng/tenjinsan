import {
  type AnalysisRevision,
  batchedCitationContext,
  batchedSourceCatalog,
  chapterMaterializationHash,
  contentDigest,
  Job,
  type NormalizationRevision,
  synthesisFindings,
  synthesisMaterializationHash,
  validatedBatchedSetupSources,
} from "@reading-studio/contracts"
import { eq } from "drizzle-orm"
import type { StorageContext } from "./database.ts"
import { ContractBoundaryError } from "./errors.ts"
import { decodeRecord } from "./records.ts"
import { jobs } from "./schema/index.ts"
import type { SourceRepository } from "./sources.ts"

export function validateBatchedAnalysis(
  record: AnalysisRevision,
  normalization: NormalizationRevision,
  access: { readonly context: StorageContext; readonly sources: SourceRepository },
) {
  const rich = record.wholeBook,
    state = rich?.batched
  if (!rich || !state) return
  const fail = () => {
    throw new ContractBoundaryError("batched analysis authority/binding")
  }
  const setup = access.sources.getSetup(state.setupId),
    grant = access.sources.getGrant(state.grantId)
  if (
    !setup ||
    !grant ||
    grant.setupRevisionId !== setup.id ||
    JSON.stringify(setup.analysis) !== JSON.stringify(record.cacheInput) ||
    JSON.stringify(setup.batchedVerificationReserve) !== JSON.stringify(state.reserve)
  )
    fail()
  if (!setup) return fail()
  const windows = validatedBatchedSetupSources(setup, normalization)
  const id = (kind: string, index = 0) =>
    `wb-${contentDigest(JSON.stringify([setup.id, state.grantId, record.cacheKey, kind, index]))}`
  const completed = (jobId: string, resultHash: string) => {
    const row = access.context.db.select().from(jobs).where(eq(jobs.id, jobId)).get()
    if (!row) return fail()
    const job = decodeRecord(Job, row.recordJson, "batch analysis job", jobId)
    if (
      job.setupRevisionId !== setup.id ||
      job.grant.id !== state.grantId ||
      job.state !== "completed" ||
      job.resultHash !== resultHash
    )
      fail()
  }
  for (const map of rich.maps) {
    const index = rich.parts.findIndex((part) => part.id === map.partId)
    if (index < 0 || map.partId !== id("map", index)) fail()
    completed(id("map", index), chapterMaterializationHash(map))
  }
  if (rich.synthesis)
    completed(id("synthesis"), synthesisMaterializationHash(rich.synthesis, id("synthesis")))
  if (state.manifest) {
    if (
      JSON.stringify(state.manifest.maps) !== JSON.stringify(rich.maps) ||
      JSON.stringify(state.manifest.synthesis) !== JSON.stringify(rich.synthesis)
    )
      fail()
    for (const [index, target] of state.manifest.targets.entries()) {
      if (target.kind !== "synthesis-citations") {
        const windowIndex = state.reserve.windowHashes.indexOf(
          target.windowHash ?? state.reserve.id,
        )
        if (
          windowIndex < 0 ||
          JSON.stringify(target.originals) !== JSON.stringify(windows[windowIndex])
        )
          fail()
      } else {
        const selected = synthesisFindings(state.manifest.synthesis).filter((finding) =>
          target.findingIds.includes(finding.id),
        )
        if (
          JSON.stringify(target.originals) !==
          JSON.stringify(
            batchedCitationContext(batchedSourceCatalog(setup, normalization), selected),
          )
        )
          fail()
      }
      const row = access.context.db
        .select()
        .from(jobs)
        .where(eq(jobs.id, id(`batch-${target.id}`, index)))
        .get()
      if (!row) fail()
      if (row) {
        const job = decodeRecord(Job, row.recordJson, "batched verification job", row.id)
        if (
          job.setupRevisionId !== setup.id ||
          job.grant.id !== state.grantId ||
          job.stage !== "analysis" ||
          job.provider !== setup.analysis.provider ||
          job.model !== setup.analysis.model ||
          job.promptVersion !== setup.analysis.analysisPromptVersion ||
          job.schemaVersion !== setup.analysis.analysisSchemaVersion
        )
          fail()
      }
    }
    for (const receipt of state.receipts) {
      const index = state.manifest.targets.findIndex((target) => target.id === receipt.targetId)
      if (index < 0) fail()
      completed(
        id(`batch-${receipt.targetId}`, index),
        contentDigest(JSON.stringify(receipt.output)),
      )
    }
  }
}
