import { createHash } from "node:crypto"
import {
  ChapterOutput,
  CoverageVerificationOutput,
  contentDigest,
  ExternalAttempt,
  type Job,
  SynthesisOutput,
} from "@reading-studio/contracts"
import { z } from "zod"
import { AnalysisPurposeError } from "./analysis-purpose-job.ts"
import type { StorageContext } from "./database.ts"

export function requireAnalysisPurposeCompletion(
  context: Pick<StorageContext, "sqlite">,
  job: Job,
  resultHash: string,
) {
  if (!job.grant.purpose) return
  const row = context.sqlite
    .prepare(
      "SELECT record_json,response_body FROM external_attempts WHERE run_id=? ORDER BY reservation DESC LIMIT 1",
    )
    .get(job.runId)
  if (!row || !job.foundationTask) throw new AnalysisPurposeError()
  const value = z
    .object({ record_json: z.string(), response_body: z.instanceof(Uint8Array) })
    .parse(row)
  const attempt = ExternalAttempt.parse(JSON.parse(value.record_json))
  if (
    attempt.state !== "response-received" ||
    createHash("sha256").update(value.response_body).digest("hex") !== attempt.responseHash
  )
    throw new AnalysisPurposeError()
  const receipt = z
    .object({
      kind: z.literal("output"),
      text: z.string(),
      batchTarget: z.unknown().optional(),
      batchManifestHash: z.string().optional(),
    })
    .parse(JSON.parse(new TextDecoder().decode(value.response_body)))
  if (
    job.foundationTask.kind === "verification" &&
    (JSON.stringify(receipt.batchTarget) !==
      JSON.stringify(job.foundationTask.manifest.targets[job.foundationTask.index]) ||
      receipt.batchManifestHash !== contentDigest(JSON.stringify(job.foundationTask.manifest)))
  )
    throw new AnalysisPurposeError()
  const raw: unknown = JSON.parse(receipt.text)
  const output =
    job.foundationTask.kind === "map"
      ? ChapterOutput.parse(raw)
      : job.foundationTask.kind === "synthesis"
        ? SynthesisOutput.parse(raw)
        : CoverageVerificationOutput.parse(raw)
  if (contentDigest(JSON.stringify(output)) !== resultHash) throw new AnalysisPurposeError()
}
