import {
  EvidenceDraft,
  GenerationRun,
  Job,
  PublicationOutput,
  TransmissionGrant,
} from "@reading-studio/contracts"
import { z } from "zod"
import { INSTALLATION_HANDLE, OWNER_HANDLE, type Row } from "./backup-schema.ts"

export function safeRecord(table: string, row: Row): Row {
  if (table === "studies") return { ...row, owner_id: OWNER_HANDLE }
  if (table === "owner_job_decisions") return { ...row, owner_id: OWNER_HANDLE }
  if (typeof row["record_json"] !== "string") return row
  const input: unknown = JSON.parse(row["record_json"])
  switch (table) {
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
