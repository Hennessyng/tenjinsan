import { contentDigest, FullBookTestConsent } from "@reading-studio/contracts"
import type Database from "better-sqlite3"
import { z } from "zod"
import { Row } from "./backup-row.ts"
import { BackupError } from "./backup-schema.ts"
import { FullBookAudit, FullBookImport } from "./full-book-portable-schema.ts"

export function assertFullBookPortable(sqlite: Database.Database, consentId?: string) {
  if (
    sqlite
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='full_book_recoveries'")
      .get() &&
    sqlite
      .prepare("SELECT 1 FROM full_book_recoveries WHERE (? IS NULL OR consent_id=?) LIMIT 1")
      .get(consentId ?? null, consentId ?? null)
  )
    throw new BackupError(
      "owner-recovery audit export is not implemented; history must remain local",
    )
  if (consentId !== undefined) {
    if (
      sqlite.prepare("SELECT 1 FROM full_book_active_consents WHERE id=?").get(consentId) ||
      sqlite
        .prepare("SELECT 1 FROM full_book_jobs WHERE consent_id=? AND state='running' LIMIT 1")
        .get(consentId) ||
      sqlite
        .prepare(
          "SELECT 1 FROM external_attempts a JOIN full_book_jobs j ON j.run_id=a.run_id WHERE j.consent_id=? AND (a.state IN ('prepared','dispatching') OR (a.state='outcome_unknown' AND json_extract(a.record_json,'$.resolution')='awaiting-owner')) LIMIT 1",
        )
        .get(consentId)
    )
      throw new BackupError("experimental scope is active or owner-unresolved")
    return
  }
  if (
    sqlite.prepare("SELECT 1 FROM full_book_active_consents LIMIT 1").get() ||
    sqlite.prepare("SELECT 1 FROM full_book_jobs WHERE state='running' LIMIT 1").get() ||
    sqlite.prepare("SELECT 1 FROM full_book_unresolved_sources LIMIT 1").get()
  )
    throw new BackupError(
      "experimental execution history is not yet portable while active or owner-unresolved",
    )
}
export function captureFullBookAudits(sqlite: Database.Database, consentId?: string) {
  assertFullBookPortable(sqlite, consentId)
  const consents = z
    .array(Row)
    .parse(
      sqlite
        .prepare(
          "SELECT id,owner_id,study_id,setup_revision_id,source_hash,budget_version,ceiling,held_calls,setup_hash,record_json FROM full_book_consents WHERE (? IS NULL OR id=?) ORDER BY rowid",
        )
        .all(consentId ?? null, consentId ?? null),
    )
  return consents.map((consent) => {
    const record = FullBookTestConsent.parse(JSON.parse(z.string().parse(consent["record_json"])))
    const id = record.id
    const jobs = z
      .array(Row)
      .parse(
        sqlite
          .prepare(
            "SELECT id,consent_id,node_index,run_id,state,fence,token,expires_at,target_hash,repair FROM full_book_jobs WHERE consent_id=? ORDER BY node_index",
          )
          .all(id),
      )
    const rows = (table: string, fields: string, order: string) =>
      z
        .array(Row)
        .parse(
          sqlite
            .prepare(
              `SELECT ${fields} FROM ${table} x WHERE x.job_id IN (SELECT id FROM full_book_jobs WHERE consent_id=?) ORDER BY ${order}`,
            )
            .all(id),
        )
    const audit = FullBookAudit.parse({
      version: "full-book-audit-1",
      authority: "historical-audit-only",
      consent,
      closure: sqlite
        .prepare("SELECT consent_id,reason FROM full_book_consent_closures WHERE consent_id=?")
        .get(id),
      study: sqlite
        .prepare("SELECT id,owner_id,edition_id FROM studies WHERE id=?")
        .get(record.studyId),
      setupJson: z
        .object({ record_json: z.string() })
        .parse(
          sqlite
            .prepare("SELECT record_json FROM setup_revisions WHERE id=?")
            .get(record.setupRevisionId),
        ).record_json,
      jobs,
      runs: sqlite
        .prepare(
          "SELECT r.id,r.input_revision_id,r.state,r.reserved_calls,r.record_json FROM generation_runs r JOIN full_book_jobs j ON j.run_id=r.id WHERE j.consent_id=? ORDER BY j.node_index",
        )
        .all(id),
      attempts: sqlite
        .prepare(
          "SELECT a.id,a.run_id,a.input_revision_id,a.state,a.reservation,a.record_json FROM external_attempts a JOIN full_book_jobs j ON j.run_id=a.run_id WHERE j.consent_id=? ORDER BY j.node_index,a.reservation",
        )
        .all(id),
      wires: rows("full_book_wires", "x.attempt_id,x.job_id,x.ordinal,x.record_json", "x.rowid"),
      receipts: rows(
        "full_book_output_receipts",
        "x.consent_id,x.node_index,x.job_id,x.attempt_id,x.record_json",
        "x.node_index",
      ),
      ...(record.session.input.hierarchyPolicy === "direct-children-2"
        ? {
            notNeeded: rows(
              "full_book_not_needed",
              "x.consent_id,x.node_index,x.job_id,x.root_hash,x.released_calls,x.record_json",
              "x.node_index",
            ),
          }
        : {}),
      managed: {
        consents: sqlite
          .prepare(
            "SELECT id,budget_consent_id,record_json FROM full_book_managed_consents WHERE budget_consent_id=? ORDER BY rowid",
          )
          .all(id),
        revocations: sqlite
          .prepare(
            "SELECT r.consent_id,r.reason FROM full_book_managed_revocations r JOIN full_book_managed_consents n ON n.id=r.consent_id WHERE n.budget_consent_id=? ORDER BY r.rowid",
          )
          .all(id),
        threads: sqlite
          .prepare(
            "SELECT t.attempt_id,t.consent_id,t.record_json FROM full_book_managed_threads t JOIN full_book_managed_consents n ON n.id=t.consent_id WHERE n.budget_consent_id=? ORDER BY t.rowid",
          )
          .all(id),
        frames: sqlite
          .prepare(
            "SELECT f.attempt_id,f.consent_id,f.record_json FROM full_book_managed_frames f JOIN full_book_managed_consents n ON n.id=f.consent_id WHERE n.budget_consent_id=? ORDER BY f.rowid",
          )
          .all(id),
        failures: sqlite
          .prepare(
            "SELECT f.attempt_id,f.consent_id,f.record_json FROM full_book_managed_failures f JOIN full_book_managed_consents n ON n.id=f.consent_id WHERE n.budget_consent_id=? ORDER BY f.rowid",
          )
          .all(id),
      },
      events: sqlite
        .prepare(
          "SELECT e.sequence,e.attempt_id,e.record_json FROM full_book_attempt_events e JOIN external_attempts a ON a.id=e.attempt_id JOIN full_book_jobs j ON j.run_id=a.run_id WHERE j.consent_id=? ORDER BY e.sequence",
        )
        .all(id),
      replies: sqlite
        .prepare(
          "SELECT m.attempt_id,m.record_json FROM full_book_reply_metadata m JOIN external_attempts a ON a.id=m.attempt_id JOIN full_book_jobs j ON j.run_id=a.run_id WHERE j.consent_id=? ORDER BY j.node_index,a.reservation",
        )
        .all(id),
    })
    const bytes = Buffer.from(JSON.stringify(audit), "utf8"),
      hash = contentDigest(bytes.toString("utf8"))
    const meta = FullBookImport.parse({
      id: hash,
      auditBlobHash: hash,
      version: audit.version,
      authority: audit.authority,
      ownerHandle: "historical-owner",
      sourceHash: record.session.input.normalization.editionHash,
      studyId: record.studyId,
      setupRevisionId: record.setupRevisionId,
      consentId: id,
      budgetVersion: consent["budget_version"],
      spent: audit.attempts.length,
      held: 0,
      originalReservedCalls: record.session.plan.maxAttempts,
      attemptIds: audit.attempts.map((row) => row["id"]),
      runIds: audit.runs.map((row) => row["id"]),
    })
    return {
      bytes,
      meta,
      row: Row.parse({
        id: hash,
        owner_id: "historical-owner",
        source_hash: meta.sourceHash,
        study_id: meta.studyId,
        setup_revision_id: meta.setupRevisionId,
        consent_id: id,
        budget_version: meta.budgetVersion,
        spent: meta.spent,
        held: 0,
        record_json: JSON.stringify(meta),
      }),
    }
  })
}
