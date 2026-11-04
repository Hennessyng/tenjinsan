import { ExternalAttempt, GenerationRun, RunAttempts } from "@reading-studio/contracts"
import type Database from "better-sqlite3"
import { z } from "zod"
import { FullBookExecutionError } from "./full-book-execution-contract.ts"
import { FullBookImport } from "./full-book-portable-schema.ts"

export function validateImportedSource(sqlite: Database.Database, owner: string, hash: string) {
  const imports = z
    .array(
      z.object({
        id: z.string(),
        source_hash: z.string(),
        budget_version: z.number(),
        spent: z.number(),
        held: z.number(),
        record_json: z.string(),
      }),
    )
    .parse(
      sqlite
        .prepare(
          "SELECT id,source_hash,budget_version,spent,held,record_json FROM full_book_imports WHERE owner_id=? AND source_hash=?",
        )
        .all(owner, hash),
    )
  for (const row of imports) {
    const meta = FullBookImport.parse(JSON.parse(row.record_json))
    if (
      meta.id !== row.id ||
      meta.sourceHash !== row.source_hash ||
      meta.spent !== row.spent ||
      meta.held !== row.held ||
      meta.budgetVersion !== row.budget_version
    )
      throw new FullBookExecutionError("history")
    const ids: string[] = []
    for (const id of meta.runIds) {
      const runRow = z
        .object({
          id: z.string(),
          state: z.string(),
          reserved_calls: z.number(),
          record_json: z.string(),
        })
        .parse(
          sqlite
            .prepare("SELECT id,state,reserved_calls,record_json FROM generation_runs WHERE id=?")
            .get(id),
        )
      const run = GenerationRun.parse(JSON.parse(runRow.record_json))
      if (
        run.id !== id ||
        runRow.state !== "paused" ||
        run.state !== "paused" ||
        run.reservedCalls !== runRow.reserved_calls ||
        run.budget.maxCalls !== 2 ||
        run.inputRevisionId !== `fb-input-${meta.consentId}`
      )
        throw new FullBookExecutionError("history")
      const attempts = z
        .array(
          z.object({
            id: z.string(),
            state: z.string(),
            reservation: z.number(),
            record_json: z.string(),
          }),
        )
        .parse(
          sqlite
            .prepare(
              "SELECT id,state,reservation,record_json FROM external_attempts WHERE run_id=? ORDER BY reservation",
            )
            .all(id),
        )
        .map((entry) => {
          const record = ExternalAttempt.parse(JSON.parse(entry.record_json))
          if (
            record.id !== entry.id ||
            record.state !== entry.state ||
            record.reservation !== entry.reservation ||
            record.state === "prepared" ||
            record.state === "dispatching" ||
            (record.state === "outcome_unknown" && record.resolution === "awaiting-owner")
          )
            throw new FullBookExecutionError("history")
          ids.push(record.id)
          return record
        })
      RunAttempts.parse({ run, attempts })
    }
    if (JSON.stringify(ids) !== JSON.stringify(meta.attemptIds))
      throw new FullBookExecutionError("history")
  }
}
