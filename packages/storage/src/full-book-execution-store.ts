import {
  contentDigest,
  ExternalAttempt,
  type FullBookTestConsent,
  FullBookTestReceipt,
  GenerationRun,
  restoreFullBookTest,
} from "@reading-studio/contracts"
import type Database from "better-sqlite3"
import { z } from "zod"
import type { StorageContext } from "./database.ts"
import type { FullBookConsentRepository } from "./full-book-consent.ts"
import {
  FullBookExecutionError,
  type FullBookLease,
  FullBookReplyMetadata,
  FullBookWire,
} from "./full-book-execution-contract.ts"
import {
  fullBookAttempts,
  fullBookJobId,
  storedFullBookConsent,
} from "./full-book-execution-history.ts"
import { checkFullBookWire, expectedFullBookWire } from "./full-book-execution-wire.ts"
import { managedReplyCoordinates } from "./full-book-managed-record.ts"
import { readUnusedBatch } from "./full-book-unused.ts"

export const FullBookJobRow = z.object({
  id: z.string(),
  consent_id: z.string(),
  node_index: z.number().int().nonnegative(),
  run_id: z.string(),
  state: z.enum(["queued", "running", "paused", "failed", "completed", "cancelled"]),
  fence: z.number().int().nonnegative(),
  token: z.string().nullable(),
  expires_at: z.string().nullable(),
  target_hash: z.string().nullable(),
  repair: z.number().int().min(0).max(1),
})
export class FullBookExecutionStore {
  constructor(
    readonly context: StorageContext,
    readonly consents: FullBookConsentRepository,
  ) {}
  get sqlite(): Database.Database {
    return this.context.sqlite
  }
  job(id: string) {
    return FullBookJobRow.parse(
      this.sqlite.prepare("SELECT * FROM full_book_jobs WHERE id=?").get(id),
    )
  }
  run(id: string) {
    const row = z
      .object({ record_json: z.string() })
      .parse(this.sqlite.prepare("SELECT record_json FROM generation_runs WHERE id=?").get(id))
    return GenerationRun.parse(JSON.parse(row.record_json))
  }
  writeRun(run: GenerationRun) {
    this.sqlite
      .prepare("UPDATE generation_runs SET state=?,reserved_calls=?,record_json=? WHERE id=?")
      .run(run.state, run.reservedCalls, JSON.stringify(run), run.id)
  }
  attempt(id: string) {
    const row = z
      .object({ record_json: z.string() })
      .parse(this.sqlite.prepare("SELECT record_json FROM external_attempts WHERE id=?").get(id))
    return ExternalAttempt.parse(JSON.parse(row.record_json))
  }
  writeAttempt(attempt: ExternalAttempt, body: string | null = null) {
    this.sqlite
      .prepare(
        "UPDATE external_attempts SET state=?,record_json=?,response_body=COALESCE(?,response_body) WHERE id=?",
      )
      .run(
        attempt.state,
        JSON.stringify(attempt),
        body === null ? null : Buffer.from(body, "utf8"),
        attempt.id,
      )
    this.event(attempt)
  }
  event(attempt: ExternalAttempt) {
    this.sqlite
      .prepare("INSERT INTO full_book_attempt_events(attempt_id,record_json) VALUES (?,?)")
      .run(attempt.id, JSON.stringify(attempt))
  }
  wire(id: string) {
    const row = z
      .object({ record_json: z.string() })
      .parse(
        this.sqlite.prepare("SELECT record_json FROM full_book_wires WHERE attempt_id=?").get(id),
      )
    const wire = FullBookWire.parse(JSON.parse(row.record_json))
    if (wire.attemptId !== id) throw new FullBookExecutionError("binding")
    return wire
  }
  expectedWire(
    consent: FullBookTestConsent,
    receipts: readonly FullBookTestReceipt[],
    options: Readonly<{ threadId: string; rpcId: number; repair: boolean }>,
  ) {
    return expectedFullBookWire(consent, receipts, options)
  }
  checkWire(
    consent: FullBookTestConsent,
    receipts: readonly FullBookTestReceipt[],
    wire: FullBookWire,
  ) {
    checkFullBookWire(consent, receipts, wire)
  }
  snapshot(id: string, active = true) {
    const consent = active ? this.consents.read(id) : storedFullBookConsent(this.sqlite, id)
    fullBookAttempts(this.sqlite, id)
    const rows = z
      .array(
        z.object({
          node_index: z.number().int().nonnegative(),
          job_id: z.string(),
          attempt_id: z.string().nullable(),
          record_json: z.string(),
        }),
      )
      .parse(
        this.sqlite
          .prepare(
            "SELECT node_index,job_id,attempt_id,record_json FROM full_book_output_receipts WHERE consent_id=? UNION ALL SELECT node_index,job_id,NULL AS attempt_id,record_json FROM full_book_not_needed WHERE consent_id=? ORDER BY node_index",
          )
          .all(id, id),
      )
    const receipts: FullBookTestReceipt[] = []
    for (const row of rows) {
      if (row.attempt_id === null) {
        const receipt = readUnusedBatch(this, consent, row.node_index)
        if (row.node_index === receipts.length) receipts.push(receipt)
        continue
      }
      const receipt = FullBookTestReceipt.parse(JSON.parse(row.record_json)),
        wire = this.wire(row.attempt_id),
        attempt = this.attempt(row.attempt_id)
      if (
        row.node_index !== receipts.length ||
        row.job_id !== fullBookJobId(consent, row.node_index) ||
        wire.jobId !== row.job_id ||
        attempt.state !== "response-received" ||
        attempt.responseHash !== receipt.outputHash ||
        receipt.outputHash !== contentDigest(receipt.serialized)
      )
        throw new FullBookExecutionError("history")
      this.checkWire(consent, receipts, wire)
      const metaRow = z
        .object({ record_json: z.string() })
        .parse(
          this.sqlite
            .prepare("SELECT record_json FROM full_book_reply_metadata WHERE attempt_id=?")
            .get(row.attempt_id),
        )
      const metadata = FullBookReplyMetadata.parse(JSON.parse(metaRow.record_json))
      const coordinates = managedReplyCoordinates(this.sqlite, wire)
      if (
        metadata.terminal !== "completed" ||
        metadata.transport !== coordinates.transport ||
        metadata.wireHash !== coordinates.wireHash ||
        metadata.targetHash !== coordinates.targetHash ||
        metadata.threadId !== coordinates.threadId ||
        metadata.requestId !== coordinates.requestId
      )
        throw new FullBookExecutionError("history")
      receipts.push(receipt)
    }
    const restored = restoreFullBookTest(consent.session, receipts)
    return { consent, receipts: restored.receipts }
  }
  requireLease(lease: FullBookLease, now: string) {
    const gate = z
      .object({ phase: z.string() })
      .parse(this.sqlite.prepare("SELECT phase FROM maintenance_gate WHERE id=1").get())
    if (gate.phase !== "idle") throw new FullBookExecutionError("state")
    const job = this.job(lease.jobId),
      snapshot = this.snapshot(lease.consentId)
    if (
      job.consent_id !== lease.consentId ||
      job.node_index !== lease.nodeIndex ||
      job.node_index !== snapshot.receipts.length ||
      job.id !== fullBookJobId(snapshot.consent, job.node_index) ||
      job.state !== "running" ||
      job.token !== lease.token ||
      job.fence !== lease.fence ||
      job.target_hash !== lease.targetHash ||
      job.expires_at !== lease.expiresAt ||
      Date.parse(now) >= Date.parse(lease.expiresAt)
    )
      throw new FullBookExecutionError("lease")
    return { job, ...snapshot }
  }
  enqueue(consent: FullBookTestConsent) {
    const existing = this.sqlite
      .prepare("SELECT 1 FROM full_book_jobs WHERE consent_id=? LIMIT 1")
      .get(consent.id)
    if (existing) return
    const inputId = `fb-input-${consent.id}`
    this.sqlite
      .prepare(
        "INSERT INTO input_revisions(id,study_id,parent_revision_id,kind) VALUES (?,?,NULL,'setup')",
      )
      .run(inputId, consent.studyId)
    for (const [index] of consent.session.plan.nodes.entries()) {
      const id = fullBookJobId(consent, index),
        run = GenerationRun.parse({
          id: `fb-${id}`,
          inputRevisionId: inputId,
          budget: { maxCalls: 2, maxTransientRetries: 0, maxSchemaRepairs: 1 },
          reservedCalls: 0,
          state: "running",
        })
      this.sqlite
        .prepare(
          "INSERT INTO generation_runs(id,input_revision_id,state,reserved_calls,record_json) VALUES (?,?,?,?,?)",
        )
        .run(run.id, inputId, run.state, 0, JSON.stringify(run))
      this.sqlite
        .prepare(
          "INSERT INTO full_book_jobs(id,consent_id,node_index,run_id,state) VALUES (?,?,?,?,'queued')",
        )
        .run(id, consent.id, index, run.id)
    }
  }
  rawConsent(id: string) {
    return storedFullBookConsent(this.sqlite, id)
  }
}
