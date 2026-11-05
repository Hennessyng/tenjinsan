import { randomUUID } from "node:crypto"
import { AttemptId, contentDigest, ExternalAttempt, GenerationRun } from "@reading-studio/contracts"
import {
  AttemptClaimInput,
  FullBookExecutionError,
  FullBookWire,
  ReplyInput,
  ReserveInput,
} from "./full-book-execution-contract.ts"
import { fullBookAttempts } from "./full-book-execution-history.ts"
import type { FullBookExecutionStore } from "./full-book-execution-store.ts"
import { managedReplyCoordinates } from "./full-book-managed-record.ts"
import { authorizeRecoveryEntry } from "./full-book-recovery-entry.ts"
import { readFullBookRecovery } from "./full-book-recovery-read.ts"

export class FullBookExecutionAttempts {
  constructor(private readonly s: FullBookExecutionStore) {}
  reserve(value: unknown) {
    const input = ReserveInput.parse(value),
      s = this.s
    return s.sqlite
      .transaction(() => {
        const { job, consent, receipts } = s.requireLease(input.lease, input.now),
          run = s.run(job.run_id)
        const amendment = readFullBookRecovery(s.sqlite, consent)
        const recovery =
          amendment?.state === "pending" && amendment.amendment.jobId === job.id ? amendment : null
        if (recovery) authorizeRecoveryEntry(s, recovery)
        const previous = fullBookAttempts(s.sqlite, consent.id)
          .filter((attempt) => attempt.runId === job.run_id)
          .at(-1)
        if ((run.state !== "running" || run.reservedCalls >= 2) && !recovery)
          throw new FullBookExecutionError("budget")
        if (
          previous &&
          !(
            (previous.state === "response-received" && job.repair === 1) ||
            (previous.state === "outcome_unknown" &&
              (previous.resolution === "retry-approved" ||
                (recovery && previous.id === recovery.amendment.priorAttemptIds[1])))
          )
        )
          throw new FullBookExecutionError("state")
        const ordinal = run.reservedCalls + 1,
          attemptId = AttemptId.parse(randomUUID())
        const expected = s.expectedWire(consent, receipts, { ...input, repair: job.repair === 1 })
        const wire = FullBookWire.parse({
          ...expected,
          attemptId,
          jobId: job.id,
          ordinal,
          dispatchKey: randomUUID(),
          threadId: input.threadId,
          rpcId: input.rpcId,
          repair: job.repair === 1,
          ...(recovery ? { recoveryId: recovery.amendment.id } : {}),
          leaseToken: input.lease.token,
          leaseFence: input.lease.fence,
          transport: "synthetic-only-no-native-entry",
        })
        const attempt = ExternalAttempt.parse({
          id: attemptId,
          runId: run.id,
          inputRevisionId: run.inputRevisionId,
          reservation: ordinal,
          preparedAt: input.now,
          state: "prepared",
        })
        if (recovery)
          s.sqlite
            .prepare("INSERT INTO full_book_recovery_uses VALUES (?,?)")
            .run(recovery.amendment.id, attemptId)
        s.sqlite
          .prepare(
            "INSERT INTO full_book_wires(attempt_id,job_id,ordinal,record_json) VALUES (?,?,?,?)",
          )
          .run(attemptId, job.id, ordinal, JSON.stringify(wire))
        s.writeRun(
          GenerationRun.parse({
            ...run,
            ...(recovery ? { budget: { ...run.budget, maxCalls: 3 }, state: "running" } : {}),
            reservedCalls: ordinal,
          }),
        )
        s.sqlite
          .prepare(
            "INSERT INTO external_attempts(id,run_id,input_revision_id,state,reservation,response_body,record_json) VALUES (?,?,?,?,?,NULL,?)",
          )
          .run(
            attempt.id,
            attempt.runId,
            attempt.inputRevisionId,
            attempt.state,
            ordinal,
            JSON.stringify(attempt),
          )
        s.event(attempt)
        return Object.freeze({ attempt, wire })
      })
      .immediate()
  }
  beforeWrite(value: unknown) {
    const input = AttemptClaimInput.parse(value),
      s = this.s
    return s.sqlite
      .transaction(() => {
        const { job, consent, receipts } = s.requireLease(input.lease, input.now),
          wire = s.wire(input.attemptId),
          attempt = s.attempt(input.attemptId)
        const recovery = readFullBookRecovery(s.sqlite, consent)
        if (recovery) authorizeRecoveryEntry(s, recovery)
        if (
          wire.jobId !== job.id ||
          wire.leaseToken !== input.lease.token ||
          wire.leaseFence !== input.lease.fence ||
          attempt.state !== "prepared"
        )
          throw new FullBookExecutionError("binding")
        s.checkWire(consent, receipts, wire)
        s.writeAttempt(
          ExternalAttempt.parse({ ...attempt, state: "dispatching", dispatchedAt: input.now }),
        )
        return wire
      })
      .immediate()
  }
  receive(value: unknown) {
    const input = ReplyInput.parse(value),
      s = this.s
    return s.sqlite
      .transaction(() => {
        const wire = s.wire(input.attemptId),
          attempt = s.attempt(input.attemptId)
        const recovery = readFullBookRecovery(s.sqlite, s.rawConsent(s.job(wire.jobId).consent_id))
        if (recovery && (wire.ordinal !== 3 || recovery.attemptId !== input.attemptId))
          throw new FullBookExecutionError("binding")
        if (
          wire.dispatchKey !== input.dispatchKey ||
          (attempt.state !== "dispatching" && attempt.state !== "outcome_unknown")
        )
          throw new FullBookExecutionError("binding")
        const coordinates = managedReplyCoordinates(s.sqlite, wire)
        if (
          input.metadata.transport !== coordinates.transport ||
          input.metadata.threadId !== coordinates.threadId ||
          input.metadata.requestId !== coordinates.requestId ||
          input.metadata.wireHash !== coordinates.wireHash ||
          input.metadata.targetHash !== coordinates.targetHash
        )
          throw new FullBookExecutionError("binding")
        const received = ExternalAttempt.parse({
          id: attempt.id,
          runId: attempt.runId,
          inputRevisionId: attempt.inputRevisionId,
          reservation: attempt.reservation,
          preparedAt: attempt.preparedAt,
          dispatchedAt: attempt.dispatchedAt,
          state: "response-received",
          receivedAt: input.receivedAt,
          responseHash: contentDigest(input.serialized),
          usage: input.usage,
        })
        s.writeAttempt(received, input.serialized)
        s.sqlite
          .prepare("INSERT INTO full_book_reply_metadata VALUES (?,?)")
          .run(attempt.id, JSON.stringify(input.metadata))
        const job = s.job(wire.jobId),
          run = s.run(job.run_id)
        if (job.state === "paused" && attempt.reservation === run.reservedCalls) {
          s.writeRun({ ...run, state: "running" })
          s.sqlite
            .prepare(
              "UPDATE full_book_jobs SET state='queued',token=NULL,expires_at=NULL WHERE id=?",
            )
            .run(job.id)
        }
        return received
      })
      .immediate()
  }
}
