import {
  contentDigest,
  ExternalAttempt,
  FullBookTestConsent,
  GenerationRun,
  RunAttempts,
} from "@reading-studio/contracts"
import type Database from "better-sqlite3"
import { z } from "zod"
import { FullBookExecutionError } from "./full-book-execution-contract.ts"
import { validateRecoveryRun } from "./full-book-recovery-history.ts"
import { readFullBookRecovery } from "./full-book-recovery-read.ts"

export function fullBookJobId(consent: FullBookTestConsent, index: number) {
  const node = consent.session.plan.nodes[index]
  if (!node) throw new FullBookExecutionError("binding")
  return contentDigest(
    JSON.stringify({
      consentId: consent.id,
      inputHash: consent.session.plan.inputHash,
      node: node.id,
    }),
  )
}
export function storedFullBookConsent(sqlite: Database.Database, id: string) {
  const row = z
    .object({ record_json: z.string() })
    .parse(sqlite.prepare("SELECT record_json FROM full_book_consents WHERE id=?").get(id))
  const consent = FullBookTestConsent.parse(JSON.parse(row.record_json))
  if (consent.id !== id) throw new FullBookExecutionError("binding")
  return consent
}
export function fullBookAttempts(sqlite: Database.Database, consentId: string) {
  const consent = storedFullBookConsent(sqlite, consentId)
  const recovery = readFullBookRecovery(sqlite, consent)
  const rows = z
    .array(
      z.object({ id: z.string(), node_index: z.number().int().nonnegative(), run_id: z.string() }),
    )
    .parse(
      sqlite
        .prepare(
          "SELECT id,node_index,run_id FROM full_book_jobs WHERE consent_id=? ORDER BY node_index",
        )
        .all(consentId),
    )
  if (rows.length && rows.length !== consent.session.plan.nodes.length)
    throw new FullBookExecutionError("history")
  const result: ExternalAttempt[] = []
  for (const [index, row] of rows.entries()) {
    if (
      row.node_index !== index ||
      row.id !== fullBookJobId(consent, index) ||
      row.run_id !== `fb-${row.id}`
    )
      throw new FullBookExecutionError("binding")
    const runRow = z
      .object({ record_json: z.string(), reserved_calls: z.number().int().nonnegative() })
      .parse(
        sqlite
          .prepare("SELECT record_json,reserved_calls FROM generation_runs WHERE id=?")
          .get(row.run_id),
      )
    const run = GenerationRun.parse(JSON.parse(runRow.record_json))
    const attempts = z
      .array(
        z.object({
          id: z.string(),
          state: z.string(),
          reservation: z.number(),
          record_json: z.string(),
          response_body: z.instanceof(Buffer).nullable(),
        }),
      )
      .parse(
        sqlite
          .prepare(
            "SELECT id,state,reservation,record_json,response_body FROM external_attempts WHERE run_id=? ORDER BY reservation",
          )
          .all(row.run_id),
      )
      .map((entry) => {
        const attempt = ExternalAttempt.parse(JSON.parse(entry.record_json))
        if (
          attempt.id !== entry.id ||
          attempt.state !== entry.state ||
          attempt.reservation !== entry.reservation ||
          (attempt.state === "response-received" &&
            (!entry.response_body ||
              contentDigest(entry.response_body.toString("utf8")) !== attempt.responseHash))
        )
          throw new FullBookExecutionError("history")
        return attempt
      })
    if (
      run.id !== row.run_id ||
      run.inputRevisionId !== `fb-input-${consentId}` ||
      run.budget.maxCalls !==
        (recovery?.state === "consumed" && recovery.amendment.runId === run.id ? 3 : 2) ||
      run.reservedCalls !== runRow.reserved_calls
    )
      throw new FullBookExecutionError("history")
    if (recovery?.state === "consumed" && recovery.amendment.runId === run.id)
      validateRecoveryRun(sqlite, { run, attempts }, recovery)
    else RunAttempts.parse({ run, attempts })
    result.push(...attempts)
  }
  return Object.freeze(result)
}
