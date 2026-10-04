import {
  Job,
  JobAuthorization,
  type Job as JobRecord,
  TransmissionAuthorization,
} from "@reading-studio/contracts"
import { currentBriefApproved } from "./brief-approval.ts"
import type { StorageContext } from "./database.ts"
import { ContractBoundaryError } from "./errors.ts"
import { encodeRecord, parseInput, writeRecord } from "./records.ts"
import { jobs } from "./schema/index.ts"
import type { SourceRepository } from "./sources.ts"

export function appendAuthorizedJob(
  context: StorageContext,
  sources: SourceRepository,
  input: unknown,
): JobRecord {
  const submitted = parseInput(Job, input, "job")
  if (submitted.stage === "outline" && !currentBriefApproved(context, submitted.inputRevisionId))
    throw new ContractBoundaryError("current brief approval required for outline job")
  const setup = sources.getSetup(submitted.setupRevisionId)
  const grant = sources.getGrant(submitted.grant.id)
  if (setup === null || grant === null) throw new ContractBoundaryError("job authorization lineage")
  const authorization = parseInput(
    TransmissionAuthorization,
    {
      setup,
      grant,
      installationId: grant.installationId,
      ownerId: grant.ownerId,
      categories: grant.categories,
    },
    "transmission authorization",
  )
  const record = parseInput(Job, { ...submitted, grant: authorization.grant }, "authoritative job")
  parseInput(JobAuthorization, { job: record, authorization }, "job authorization")
  return writeRecord("job", record.id, () => {
    context.db
      .insert(jobs)
      .values({
        id: record.id,
        runId: record.runId,
        inputRevisionId: record.inputRevisionId,
        setupRevisionId: record.setupRevisionId,
        grantId: record.grant.id,
        state: record.state,
        checkpoint: record.checkpoint,
        cancellationRequested: record.cancellationRequested,
        leaseFence: record.state === "running" ? record.lease.fence : 0,
        leaseToken: record.state === "running" ? record.lease.token : null,
        leaseExpiresAt: record.state === "running" ? record.lease.expiresAt : null,
        recordJson: encodeRecord(record),
      })
      .run()
    return record
  })
}
