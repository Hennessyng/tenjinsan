import { randomUUID } from "node:crypto"
import {
  Job,
  JobId,
  type Job as JobRecord,
  OwnerId,
  SetupRevisionId,
} from "@reading-studio/contracts"
import { eq } from "drizzle-orm"
import { z } from "zod"
import type { StorageContext } from "./database.ts"
import { ExecutionTransitionError } from "./errors.ts"
import type { ExecutionRepository } from "./execution.ts"
import { decodeRecord, parseInput } from "./records.ts"
import { jobs, setupRevisions, studies } from "./schema/index.ts"
import type { SourceRepository } from "./sources.ts"

const OwnerDecision = z.strictObject({
  jobId: JobId,
  ownerId: OwnerId,
  expectedSetupRevisionId: SetupRevisionId,
  action: z.enum(["cancel", "retry", "stop-approved", "retry-approved"]),
  reason: z.string().trim().min(8).max(500),
})

export class OwnerJobOperations {
  constructor(
    private readonly context: StorageContext,
    private readonly sources: SourceRepository,
    private readonly execution: ExecutionRepository,
  ) {}

  list(input: unknown): readonly JobRecord[] {
    const ownerId = parseInput(OwnerId, input, "owner ID")
    return this.context.db
      .select({ id: jobs.id, recordJson: jobs.recordJson })
      .from(jobs)
      .innerJoin(setupRevisions, eq(jobs.setupRevisionId, setupRevisions.id))
      .innerJoin(studies, eq(setupRevisions.studyId, studies.id))
      .where(eq(studies.ownerId, ownerId))
      .all()
      .map((row) => decodeRecord(Job, row.recordJson, "job", row.id))
  }

  decide(input: unknown): JobRecord {
    const decision = OwnerDecision.parse(input)
    return this.context.sqlite
      .transaction(() => {
        const job = this.execution.getJob(decision.jobId)
        const setup = job && this.sources.getSetup(job.setupRevisionId)
        if (
          !job ||
          !setup ||
          setup.id !== decision.expectedSetupRevisionId ||
          this.sources.getLatestSetup(setup.studyId)?.id !== setup.id ||
          !this.sources
            .listStudiesByEdition(setup.editionId)
            .some((study) => study.id === setup.studyId && study.ownerId === decision.ownerId) ||
          job.grant.ownerId !== decision.ownerId ||
          job.grant.installationId !== this.sources.getInstallation(decision.ownerId) ||
          this.sources.getGrant(job.grant.id)?.kind !== "active"
        )
          throw new ExecutionTransitionError("job", decision.jobId, "current owned setup")
        const attempts = this.execution.listAttempts(job.runId)
        if (
          job.provider === "openai" &&
          (decision.action === "retry" || decision.action === "retry-approved")
        )
          throw new ExecutionTransitionError("job", job.id, "historical provider is inert")
        const unknown = attempts.find(
          (attempt) =>
            attempt.state === "outcome_unknown" && attempt.resolution === "awaiting-owner",
        )
        let updated: JobRecord
        switch (decision.action) {
          case "cancel":
            if (
              !(["queued", "running", "paused"] as readonly string[]).includes(job.state) ||
              unknown
            )
              throw new ExecutionTransitionError("job", job.id, "cancellable")
            updated = this.execution.requestCancellation({ jobId: job.id })
            break
          case "retry":
            updated = this.execution.retryProviderJob(job.id)
            break
          case "stop-approved":
          case "retry-approved": {
            if (!unknown) throw new ExecutionTransitionError("job", job.id, "unknown attempt")
            this.execution.resolveUnknownAttempt({
              attemptId: unknown.id,
              resolution: decision.action,
            })
            const resolved = this.execution.getJob(job.id)
            if (!resolved) throw new ExecutionTransitionError("job", job.id, "persisted")
            updated = resolved
            break
          }
          default:
            throw new ExecutionTransitionError("job", job.id, "recognized owner action")
        }
        this.context.sqlite
          .prepare(
            "INSERT INTO owner_job_decisions (id, job_id, owner_id, setup_revision_id, action, reason, decided_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          )
          .run(
            randomUUID(),
            job.id,
            decision.ownerId,
            setup.id,
            decision.action,
            decision.reason,
            new Date().toISOString(),
          )
        return updated
      })
      .immediate()
  }
}
