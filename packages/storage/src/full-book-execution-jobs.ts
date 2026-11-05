import { assertNever, ExternalAttempt, fullBookTestTarget } from "@reading-studio/contracts"
import { z } from "zod"
import {
  ClaimInput,
  FullBookExecutionError,
  FullBookLease,
} from "./full-book-execution-contract.ts"
import { fullBookAttempts, fullBookJobId } from "./full-book-execution-history.ts"
import { type FullBookExecutionStore, FullBookJobRow } from "./full-book-execution-store.ts"
import { authorizeRecoveryEntry } from "./full-book-recovery-entry.ts"
import { readFullBookRecovery } from "./full-book-recovery-read.ts"

export class FullBookExecutionJobs {
  constructor(private readonly store: FullBookExecutionStore) {}
  claim(value: unknown) {
    const input = ClaimInput.parse(value),
      s = this.store
    if (Date.parse(input.expiresAt) <= Date.parse(input.now))
      throw new FullBookExecutionError("lease")
    return s.sqlite
      .transaction(() => {
        const gate = z
          .object({ phase: z.string() })
          .parse(s.sqlite.prepare("SELECT phase FROM maintenance_gate WHERE id=1").get())
        if (gate.phase !== "idle") throw new FullBookExecutionError("state")
        if (
          s.sqlite
            .prepare("SELECT 1 FROM full_book_consent_closures WHERE consent_id=?")
            .get(input.consentId)
        ) {
          s.snapshot(input.consentId, false)
          return null
        }
        const consent = s.consents.read(input.consentId)
        const recovery = readFullBookRecovery(s.sqlite, consent)
        if (recovery?.state === "consumed") return null
        if (recovery) authorizeRecoveryEntry(s, recovery)
        s.enqueue(consent)
        const snapshot = s.snapshot(consent.id),
          index = snapshot.receipts.length
        if (index === consent.session.plan.nodes.length) return null
        const job = s.job(fullBookJobId(consent, index))
        if (
          job.state !== "queued" &&
          !(
            job.state === "paused" &&
            recovery?.state === "pending" &&
            recovery.amendment.jobId === job.id
          )
        )
          return null
        if (recovery && recovery.amendment.jobId !== job.id) return null
        const target = fullBookTestTarget(consent.session, snapshot.receipts)
        if (job.target_hash !== null && job.target_hash !== target.hash)
          throw new FullBookExecutionError("binding")
        const fence = job.fence + 1
        s.sqlite
          .prepare(
            "UPDATE full_book_jobs SET state='running',fence=?,token=?,expires_at=?,target_hash=? WHERE id=?",
          )
          .run(fence, input.token, input.expiresAt, target.hash, job.id)
        return FullBookLease.parse({
          consentId: consent.id,
          jobId: job.id,
          nodeIndex: index,
          targetHash: target.hash,
          token: input.token,
          fence,
          expiresAt: input.expiresAt,
        })
      })
      .immediate()
  }
  recover(value: unknown) {
    const input = z.strictObject({ consentId: z.uuid(), now: z.iso.datetime() }).parse(value),
      s = this.store
    return s.sqlite
      .transaction(() => {
        s.rawConsent(input.consentId)
        fullBookAttempts(s.sqlite, input.consentId)
        const rows = z
          .array(FullBookJobRow)
          .parse(
            s.sqlite
              .prepare(
                "SELECT * FROM full_book_jobs WHERE consent_id=? AND state='running' AND julianday(expires_at)<=julianday(?)",
              )
              .all(input.consentId, input.now),
          )
        for (const job of rows) {
          const latest = fullBookAttempts(s.sqlite, input.consentId)
            .filter((attempt) => attempt.runId === job.run_id)
            .at(-1)
          let paused = false
          if (latest)
            switch (latest.state) {
              case "prepared":
              case "dispatching": {
                const unknown = ExternalAttempt.parse({
                  id: latest.id,
                  runId: latest.runId,
                  inputRevisionId: latest.inputRevisionId,
                  reservation: latest.reservation,
                  preparedAt: latest.preparedAt,
                  dispatchedAt:
                    latest.state === "dispatching" ? latest.dispatchedAt : latest.preparedAt,
                  state: "outcome_unknown",
                  usage: { kind: "unknown" },
                  resolution: "awaiting-owner",
                })
                s.writeAttempt(unknown)
                s.writeRun({ ...s.run(job.run_id), state: "paused" })
                paused = true
                break
              }
              case "outcome_unknown":
                paused = true
                break
              case "response-received":
                break
              default:
                assertNever(latest)
            }
          s.sqlite
            .prepare("UPDATE full_book_jobs SET state=?,token=NULL,expires_at=NULL WHERE id=?")
            .run(paused ? "paused" : "queued", job.id)
        }
        return rows.length
      })
      .immediate()
  }
  interrupt(value: unknown) {
    const input = z.strictObject({ lease: FullBookLease, attemptId: z.string() }).parse(value),
      s = this.store
    return s.sqlite
      .transaction(() => {
        const job = s.job(input.lease.jobId),
          attempt = s.attempt(input.attemptId)
        if (
          job.consent_id !== input.lease.consentId ||
          job.fence !== input.lease.fence ||
          job.token !== input.lease.token ||
          attempt.runId !== job.run_id
        )
          throw new FullBookExecutionError("lease")
        if (attempt.state === "outcome_unknown" || attempt.state === "response-received")
          return attempt
        const unknown = ExternalAttempt.parse({
          id: attempt.id,
          runId: attempt.runId,
          inputRevisionId: attempt.inputRevisionId,
          reservation: attempt.reservation,
          preparedAt: attempt.preparedAt,
          dispatchedAt: attempt.state === "dispatching" ? attempt.dispatchedAt : attempt.preparedAt,
          state: "outcome_unknown",
          usage: { kind: "unknown" },
          resolution: "awaiting-owner",
        })
        s.writeAttempt(unknown)
        s.writeRun({ ...s.run(job.run_id), state: "paused" })
        s.sqlite
          .prepare("UPDATE full_book_jobs SET state='paused',token=NULL,expires_at=NULL WHERE id=?")
          .run(job.id)
        return unknown
      })
      .immediate()
  }
  resolve(value: unknown) {
    const input = z
        .strictObject({ attemptId: z.string(), decision: z.enum(["retry", "stop"]) })
        .parse(value),
      s = this.store
    return s.sqlite
      .transaction(() => {
        const attempt = s.attempt(input.attemptId),
          wire = s.wire(input.attemptId),
          job = s.job(wire.jobId),
          run = s.run(job.run_id)
        if (
          input.decision === "retry" &&
          readFullBookRecovery(s.sqlite, s.rawConsent(job.consent_id))
        )
          throw new FullBookExecutionError("disabled")
        if (attempt.state !== "outcome_unknown" || attempt.resolution !== "awaiting-owner")
          throw new FullBookExecutionError("state")
        switch (input.decision) {
          case "retry":
            s.consents.read(job.consent_id)
            if (run.reservedCalls >= 2) throw new FullBookExecutionError("budget")
            s.writeAttempt({ ...attempt, resolution: "retry-approved" })
            s.writeRun({ ...run, state: "running" })
            s.sqlite
              .prepare(
                "UPDATE full_book_jobs SET state='queued',token=NULL,expires_at=NULL WHERE id=?",
              )
              .run(job.id)
            break
          case "stop":
            s.writeAttempt({ ...attempt, resolution: "stop-approved" })
            s.writeRun({ ...run, state: "cancelled" })
            s.sqlite
              .prepare(
                "UPDATE full_book_jobs SET state='cancelled',token=NULL,expires_at=NULL WHERE id=?",
              )
              .run(job.id)
            this.cancel(job.consent_id, "Owner stopped an unknown experimental attempt")
            break
          default:
            assertNever(input.decision)
        }
      })
      .immediate()
  }
  cancel(id: string, reason: string) {
    const s = this.store
    s.sqlite
      .transaction(() => {
        s.rawConsent(id)
        const attempts = fullBookAttempts(s.sqlite, id)
        for (const attempt of attempts)
          switch (attempt.state) {
            case "prepared":
            case "dispatching":
              s.writeAttempt(
                ExternalAttempt.parse({
                  id: attempt.id,
                  runId: attempt.runId,
                  inputRevisionId: attempt.inputRevisionId,
                  reservation: attempt.reservation,
                  preparedAt: attempt.preparedAt,
                  dispatchedAt:
                    attempt.state === "dispatching" ? attempt.dispatchedAt : attempt.preparedAt,
                  state: "outcome_unknown",
                  usage: { kind: "unknown" },
                  resolution: "stop-approved",
                }),
              )
              break
            case "outcome_unknown":
              if (attempt.resolution === "awaiting-owner")
                s.writeAttempt({ ...attempt, resolution: "stop-approved" })
              break
            case "response-received":
              break
            default:
              assertNever(attempt)
          }
        const jobs = z
          .array(FullBookJobRow)
          .parse(
            s.sqlite
              .prepare("SELECT * FROM full_book_jobs WHERE consent_id=? AND state!='completed'")
              .all(id),
          )
        for (const job of jobs) {
          s.writeRun({ ...s.run(job.run_id), state: "cancelled" })
          s.sqlite
            .prepare(
              "UPDATE full_book_jobs SET state='cancelled',token=NULL,expires_at=NULL WHERE id=?",
            )
            .run(job.id)
        }
        if (
          !s.sqlite.prepare("SELECT 1 FROM full_book_consent_closures WHERE consent_id=?").get(id)
        )
          s.consents.close(id, reason)
      })
      .immediate()
  }
}
