import {
  analysisCacheKey,
  analysisInputIdentity,
  BatchedVerificationManifest,
  batchedCitationContext,
  batchedSourceCatalog,
  chapterMaterializationHash,
  contentDigest,
  foundationJobIdentity,
  Job,
  NormalizationRevision,
  RunId,
  StudySetupRevision,
  synthesisFindings,
  synthesisMaterializationHash,
  TransmissionAuthorization,
  TransmissionGrant,
  validatedBatchedSetupSources,
} from "@reading-studio/contracts"
import { z } from "zod"
import type { StorageContext } from "./database.ts"
import { ContractBoundaryError } from "./errors.ts"

export class AnalysisPurposeError extends ContractBoundaryError {
  override readonly name = "AnalysisPurposeError"
  constructor() {
    super("analysis-evaluation-purpose")
  }
}
type Access = Pick<StorageContext, "sqlite" | "liveStudyGuard">
const Row = z.object({ record_json: z.string() })
export function requireAnalysisPurposeJob(
  access: Access,
  job: Job,
  inserting = false,
  resolvingUnknown = false,
) {
  const setupRow = access.sqlite
    .prepare("SELECT record_json FROM setup_revisions WHERE id=?")
    .get(job.setupRevisionId)
  const setup = setupRow
    ? StudySetupRevision.parse(JSON.parse(Row.parse(setupRow).record_json))
    : null
  if (!setup?.analysis.purpose) {
    if (job.grant.purpose || job.foundationTask) throw new AnalysisPurposeError()
    return
  }
  const fail = () => {
    throw new AnalysisPurposeError()
  }
  if (resolvingUnknown) access.liveStudyGuard.assertPurposeTargetOnly(setup.id)
  else access.liveStudyGuard.assertActive(setup.id)
  const grantRow = access.sqlite
    .prepare("SELECT record_json FROM transmission_grants WHERE id=?")
    .get(job.grant.id)
  const grant = grantRow
    ? TransmissionGrant.parse(JSON.parse(Row.parse(grantRow).record_json))
    : null
  if (
    !grant ||
    !TransmissionAuthorization.safeParse({
      setup,
      grant,
      ownerId: grant.ownerId,
      installationId: grant.installationId,
      categories: ["book-text", "derived-study-material"],
    }).success
  )
    fail()
  const reserve = setup.batchedVerificationReserve,
    proof = job.foundationTask
  if (
    !reserve ||
    !("purpose" in reserve) ||
    !reserve.purpose ||
    !proof ||
    job.stage !== "analysis" ||
    job.runId !== RunId.parse(job.id) ||
    job.inputRevisionId !== analysisInputIdentity(setup.id, setup.analysis.purpose) ||
    job.provider !== setup.analysis.provider ||
    job.model !== setup.analysis.model ||
    job.promptVersion !== setup.analysis.analysisPromptVersion ||
    job.schemaVersion !== setup.analysis.analysisSchemaVersion ||
    JSON.stringify(job.grant.purpose) !== JSON.stringify(setup.analysis.purpose)
  )
    return fail()
  const key = analysisCacheKey(setup.analysis),
    id = (kind: string, index = 0) =>
      foundationJobIdentity(setup.id, job.grant.id, key, kind, index)
  const rows = access.sqlite
    .prepare("SELECT record_json FROM jobs WHERE setup_revision_id=?")
    .all(setup.id)
  if (inserting && rows.length >= reserve.maxAnalysisJobs) fail()
  const completed = (jobId: string, hash?: string) => {
    const row = access.sqlite.prepare("SELECT record_json FROM jobs WHERE id=?").get(jobId)
    if (!row) return fail()
    const record = Job.parse(JSON.parse(Row.parse(row).record_json))
    if (
      record.state !== "completed" ||
      record.grant.id !== job.grant.id ||
      (hash !== undefined && record.resultHash !== hash)
    )
      fail()
  }
  switch (proof.kind) {
    case "map":
      if (proof.index >= reserve.windowHashes.length || job.id !== id("map", proof.index)) fail()
      return
    case "synthesis":
      if (job.id !== id("synthesis")) fail()
      for (let index = 0; index < reserve.windowHashes.length; index++) completed(id("map", index))
      return
    case "verification": {
      const manifest = BatchedVerificationManifest.parse(proof.manifest),
        target = manifest.targets[proof.index]
      if (
        !target ||
        job.id !== id(`batch-${target.id}`, proof.index) ||
        JSON.stringify(manifest.reserve) !== JSON.stringify(reserve)
      )
        fail()
      if (!target) return fail()
      const normalizationRow = access.sqlite
        .prepare("SELECT record_json FROM normalization_revisions WHERE id=?")
        .get(setup.analysis.normalizationRevisionId)
      if (!normalizationRow) return fail()
      const normalization = NormalizationRevision.parse(
        JSON.parse(Row.parse(normalizationRow).record_json),
      )
      const windows = validatedBatchedSetupSources(setup, normalization)
      for (const [index, map] of manifest.maps.entries()) {
        if (
          map.partId !== id("map", index) ||
          map.groupId !== setup.analysis.processing?.plan?.[index]?.groupId
        )
          fail()
        completed(id("map", index), chapterMaterializationHash(map))
      }
      completed(id("synthesis"), synthesisMaterializationHash(manifest.synthesis, id("synthesis")))
      for (const value of manifest.targets) {
        const originals =
          value.kind === "synthesis-citations"
            ? batchedCitationContext(
                batchedSourceCatalog(setup, normalization),
                synthesisFindings(manifest.synthesis).filter((finding) =>
                  value.findingIds.includes(finding.id),
                ),
              )
            : windows[value.windowHash ? reserve.windowHashes.indexOf(value.windowHash) : -1]
        if (JSON.stringify(value.originals) !== JSON.stringify(originals)) fail()
      }
      const serialized = JSON.stringify(manifest)
      for (const row of rows) {
        const other = Job.parse(JSON.parse(Row.parse(row).record_json))
        if (
          other.foundationTask?.kind === "verification" &&
          JSON.stringify(other.foundationTask.manifest) !== serialized
        )
          fail()
      }
      const bound = access.sqlite
        .prepare(
          "SELECT record_json FROM analysis_revisions WHERE json_extract(record_json,'$.wholeBook.batched.setupId')=? AND json_extract(record_json,'$.wholeBook.batched.grantId')=? AND json_type(record_json,'$.wholeBook.batched.manifest')='object' ORDER BY rowid DESC LIMIT 1",
        )
        .get(setup.id, job.grant.id)
      if (bound) {
        const saved = z
          .object({
            wholeBook: z.object({ batched: z.object({ manifest: BatchedVerificationManifest }) }),
          })
          .parse(JSON.parse(Row.parse(bound).record_json))
        if (
          contentDigest(JSON.stringify(saved.wholeBook.batched.manifest)) !==
          contentDigest(serialized)
        )
          fail()
      }
      return
    }
    default: {
      const never: never = proof
      throw new TypeError(String(never))
    }
  }
}
