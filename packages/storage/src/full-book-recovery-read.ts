import { FullBookManagedConsent, type FullBookTestConsent } from "@reading-studio/contracts"
import type Database from "better-sqlite3"
import { z } from "zod"
import { FullBookExecutionError } from "./full-book-execution-contract.ts"
import { requireRecoveryBinding } from "./full-book-recovery-binding.ts"
import { FullBookRecoveryAmendment } from "./full-book-recovery-record.ts"

export function readFullBookRecovery(sqlite: Database.Database, budget: FullBookTestConsent) {
  if (
    !sqlite
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='full_book_recoveries'")
      .get()
  )
    return null
  const raw = sqlite
    .prepare(
      "SELECT id,consent_id,native_consent_id,job_id,effective_ceiling,record_json FROM full_book_recoveries WHERE consent_id=?",
    )
    .get(budget.id)
  if (!raw) return null
  const row = z
    .object({
      id: z.string(),
      consent_id: z.string(),
      native_consent_id: z.string(),
      job_id: z.string(),
      effective_ceiling: z.number(),
      record_json: z.string(),
    })
    .parse(raw)
  const amendment = FullBookRecoveryAmendment.parse(JSON.parse(row.record_json))
  const native = z
    .object({ record_json: z.string() })
    .parse(
      sqlite
        .prepare("SELECT record_json FROM full_book_managed_consents WHERE id=?")
        .get(row.native_consent_id),
    )
  const grant = FullBookManagedConsent.parse(JSON.parse(native.record_json))
  requireRecoveryBinding({ grant, budget }, amendment)
  const job = z
    .object({ id: z.string(), run_id: z.string(), node_index: z.number() })
    .parse(
      sqlite
        .prepare(
          "SELECT id,run_id,node_index FROM full_book_jobs WHERE consent_id=? AND node_index=0",
        )
        .get(budget.id),
    )
  const prior = z
    .array(
      z.object({
        id: z.string(),
        state: z.literal("outcome_unknown"),
        reservation: z.number(),
        resolution: z.string(),
      }),
    )
    .parse(
      sqlite
        .prepare(
          "SELECT id,state,reservation,json_extract(record_json,'$.resolution') AS resolution FROM external_attempts WHERE run_id=? AND reservation<=2 ORDER BY reservation",
        )
        .all(job.run_id),
    )
  if (
    row.id !== amendment.id ||
    row.consent_id !== amendment.budgetConsentId ||
    row.job_id !== amendment.jobId ||
    row.effective_ceiling !== amendment.effectiveCeiling ||
    job.id !== amendment.jobId ||
    job.run_id !== amendment.runId ||
    job.node_index !== 0 ||
    prior.length !== 2 ||
    prior[0]?.id !== amendment.priorAttemptIds[0] ||
    prior[1]?.id !== amendment.priorAttemptIds[1] ||
    prior[0]?.reservation !== 1 ||
    prior[1]?.reservation !== 2 ||
    prior[0]?.resolution !== "retry-approved" ||
    (prior[1]?.resolution !== "awaiting-owner" && prior[1]?.resolution !== "stop-approved")
  )
    throw new FullBookExecutionError("history")
  const use = z
    .object({ attempt_id: z.string() })
    .optional()
    .parse(
      sqlite
        .prepare("SELECT attempt_id FROM full_book_recovery_uses WHERE amendment_id=?")
        .get(amendment.id),
    )
  return {
    amendment,
    state: use ? ("consumed" as const) : ("pending" as const),
    attemptId: use?.attempt_id ?? null,
    originalCeiling: amendment.originalCeiling,
    effectiveCeiling: amendment.effectiveCeiling,
    stopAfterResult: true as const,
  }
}
