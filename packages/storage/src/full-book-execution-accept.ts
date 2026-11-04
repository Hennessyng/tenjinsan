import {
  acceptFullBookTestOutput,
  FullBookConsentError,
  FullBookOutputError,
  FullBookTestError,
  measureFullBookTestPayload,
} from "@reading-studio/contracts"
import { z } from "zod"
import {
  AttemptClaimInput,
  FullBookExecutionError,
  FullBookReplyMetadata,
} from "./full-book-execution-contract.ts"
import type { FullBookExecutionStore } from "./full-book-execution-store.ts"
import { FullBookManagedConsents } from "./full-book-managed-consent.ts"
import { vacateUnusedBatches } from "./full-book-unused.ts"

export function acceptFullBookReply(s: FullBookExecutionStore, value: unknown) {
  const input = AttemptClaimInput.parse(value)
  return s.sqlite
    .transaction(() => {
      const attempt = s.attempt(input.attemptId),
        wire = s.wire(input.attemptId),
        job = s.job(input.lease.jobId),
        run = s.run(job.run_id)
      if (
        wire.jobId !== job.id ||
        job.consent_id !== input.lease.consentId ||
        job.state !== "running" ||
        job.token !== input.lease.token ||
        job.fence !== input.lease.fence ||
        attempt.state !== "response-received" ||
        attempt.reservation !== run.reservedCalls ||
        Date.parse(input.now) >= Date.parse(input.lease.expiresAt)
      )
        throw new FullBookExecutionError("lease")
      let snapshot: ReturnType<typeof s.snapshot>
      try {
        snapshot = s.requireLease(input.lease, input.now)
        const native = s.sqlite
          .prepare("SELECT consent_id FROM full_book_managed_frames WHERE attempt_id=?")
          .get(attempt.id)
        if (native)
          new FullBookManagedConsents(s.context, s.consents).read(
            z.object({ consent_id: z.string() }).parse(native).consent_id,
          )
      } catch (error) {
        if (!(error instanceof FullBookConsentError)) throw error
        s.sqlite
          .prepare(
            "UPDATE full_book_jobs SET state='cancelled',token=NULL,expires_at=NULL WHERE id=?",
          )
          .run(job.id)
        s.writeRun({ ...run, state: "cancelled" })
        return { kind: "authority-denied" as const }
      }
      s.checkWire(snapshot.consent, snapshot.receipts, wire)
      const metaRow = z
        .object({ record_json: z.string() })
        .parse(
          s.sqlite
            .prepare("SELECT record_json FROM full_book_reply_metadata WHERE attempt_id=?")
            .get(attempt.id),
        )
      const metadata = FullBookReplyMetadata.parse(JSON.parse(metaRow.record_json))
      if (metadata.terminal !== "completed") {
        s.sqlite
          .prepare("UPDATE full_book_jobs SET state='failed',token=NULL,expires_at=NULL WHERE id=?")
          .run(job.id)
        s.writeRun({ ...run, state: "failed" })
        return { kind: "rejected" as const }
      }
      const row = z
        .object({ response_body: z.instanceof(Buffer) })
        .parse(
          s.sqlite
            .prepare("SELECT response_body FROM external_attempts WHERE id=?")
            .get(attempt.id),
        )
      let next: ReturnType<typeof acceptFullBookTestOutput>
      try {
        measureFullBookTestPayload(snapshot.consent.session.input, {
          kind: "derived-output",
          serialized: row.response_body.toString("utf8"),
        })
        next = acceptFullBookTestOutput(
          snapshot.consent.session,
          snapshot.receipts,
          row.response_body.toString("utf8"),
        )
      } catch (error) {
        const schema = error instanceof z.ZodError || error instanceof SyntaxError
        if (
          !schema &&
          !(error instanceof FullBookOutputError) &&
          !(error instanceof FullBookTestError)
        )
          throw error
        const repair = schema && run.reservedCalls < 2
        s.sqlite
          .prepare(
            "UPDATE full_book_jobs SET state=?,repair=?,token=NULL,expires_at=NULL WHERE id=?",
          )
          .run(repair ? "queued" : "failed", repair ? 1 : 0, job.id)
        s.writeRun({ ...run, state: repair ? "running" : "failed" })
        return { kind: repair ? ("repair-required" as const) : ("rejected" as const) }
      }
      const receipt = next.at(-1)
      if (!receipt) throw new FullBookExecutionError("history")
      s.sqlite
        .prepare(
          "INSERT INTO full_book_output_receipts(consent_id,node_index,job_id,attempt_id,record_json) VALUES (?,?,?,?,?)",
        )
        .run(snapshot.consent.id, job.node_index, job.id, attempt.id, JSON.stringify(receipt))
      s.sqlite
        .prepare(
          "UPDATE full_book_jobs SET state='completed',token=NULL,expires_at=NULL WHERE id=?",
        )
        .run(job.id)
      s.writeRun({ ...run, state: "completed" })
      if (
        snapshot.consent.session.plan.nodes[job.node_index]?.id ===
        snapshot.consent.session.plan.root
      )
        vacateUnusedBatches(s, snapshot.consent, receipt)
      if (
        s.snapshot(snapshot.consent.id).receipts.length ===
        snapshot.consent.session.plan.nodes.length
      )
        s.consents.close(snapshot.consent.id, "Experimental finite plan complete")
      return { kind: "accepted" as const }
    })
    .immediate()
}
