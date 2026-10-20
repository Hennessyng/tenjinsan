import { createHmac, randomBytes } from "node:crypto"
import {
  AnalysisCacheInput,
  AnalysisRevision,
  analysisCacheKey,
  EvidenceDraft,
  GenerationRun,
  Job,
  PublicationOutput,
  StudySetupRevision,
  TransmissionGrant,
} from "@reading-studio/contracts"
import { z } from "zod"
import { INSTALLATION_HANDLE, OWNER_HANDLE, type Row } from "./backup-schema.ts"

function historicalAnalysis(
  input: AnalysisCacheInput,
  redactionKey: Uint8Array,
): AnalysisCacheInput {
  if (!input.destination) return input
  const destination = input.destination
  const historicalId = /^historical-account-([a-f0-9]{64})$/.exec(destination.accountId)?.[1]
  if (
    historicalId &&
    destination.installationId === `historical-installation-${historicalId}` &&
    destination.workspaceId === null &&
    destination.connectionRevision === Number.MAX_SAFE_INTEGER &&
    destination.observedAccount === undefined
  )
    return input
  // One private key per capture keeps aliases consistent without enabling identity guessing from an archive.
  const id = createHmac("sha256", redactionKey)
    .update(
      JSON.stringify([
        destination.provider,
        destination.accountId,
        destination.workspaceId,
        destination.installationId,
        destination.connectionRevision,
        destination.billingRoute,
        destination.observedAccount,
      ]),
    )
    .digest("hex")
  return AnalysisCacheInput.parse({
    ...input,
    destination: {
      ...input.destination,
      accountId: `historical-account-${id}`,
      workspaceId: null,
      installationId: `historical-installation-${id}`,
      connectionRevision: Number.MAX_SAFE_INTEGER,
      observedAccount: undefined,
    },
  })
}

export function safeRecord(
  table: string,
  row: Row,
  redactionKey: Uint8Array = randomBytes(32),
): Row {
  if (table === "studies") return { ...row, owner_id: OWNER_HANDLE }
  if (table === "owner_job_decisions") return { ...row, owner_id: OWNER_HANDLE }
  if (typeof row["record_json"] !== "string") return row
  const input: unknown = JSON.parse(row["record_json"])
  switch (table) {
    case "setup_revisions": {
      const setup = StudySetupRevision.parse(input)
      return {
        ...row,
        record_json: JSON.stringify({
          ...setup,
          analysis: historicalAnalysis(setup.analysis, redactionKey),
        }),
      }
    }
    case "analysis_revisions": {
      const analysis = AnalysisRevision.parse(input)
      const cacheInput = historicalAnalysis(analysis.cacheInput, redactionKey)
      const cacheKey = analysisCacheKey(cacheInput)
      return {
        ...row,
        cache_key: cacheKey,
        record_json: JSON.stringify({ ...analysis, cacheInput, cacheKey }),
      }
    }
    case "transmission_grants": {
      const grant = TransmissionGrant.parse(input)
      const record = {
        kind: "historical",
        id: grant.id,
        setupRevisionId: grant.setupRevisionId,
        installationId: INSTALLATION_HANDLE,
        ownerId: OWNER_HANDLE,
        categories: grant.categories,
        approvedAt: grant.approvedAt,
      }
      return {
        ...row,
        kind: "historical",
        installation_id: INSTALLATION_HANDLE,
        owner_id: OWNER_HANDLE,
        record_json: JSON.stringify(record),
      }
    }
    case "jobs": {
      const job = Job.parse(input)
      const grantRow = safeRecord("transmission_grants", { record_json: JSON.stringify(job.grant) })
      const grant = TransmissionGrant.parse(JSON.parse(z.string().parse(grantRow["record_json"])))
      const record = Job.parse({
        id: job.id,
        runId: job.runId,
        inputRevisionId: job.inputRevisionId,
        setupRevisionId: job.setupRevisionId,
        provider: job.provider,
        model: job.model,
        promptVersion: job.promptVersion,
        schemaVersion: job.schemaVersion,
        grant,
        stage: job.stage,
        checkpoint: job.checkpoint,
        cancellationRequested: false,
        usage: job.usage,
        state: "paused",
        reason: "restored",
      })
      return {
        ...row,
        state: "paused",
        cancellation_requested: 0,
        record_json: JSON.stringify(record),
      }
    }
    case "generation_runs": {
      const run = GenerationRun.parse(input)
      return { ...row, state: "paused", record_json: JSON.stringify({ ...run, state: "paused" }) }
    }
    case "evidence_review_drafts": {
      const draft = EvidenceDraft.parse(input)
      return {
        ...row,
        record_json: JSON.stringify({ ...draft, privacyReviewed: false, keepPrivate: true }),
      }
    }
    case "publication_outputs": {
      const output = PublicationOutput.parse(input)
      if (output.state !== "running") return row
      return {
        ...row,
        state: "queued",
        record_json: JSON.stringify({ ...output, state: "queued", expiresAt: null }),
      }
    }
    default:
      return row
  }
}
