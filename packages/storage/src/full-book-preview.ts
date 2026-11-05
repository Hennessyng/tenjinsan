import type Database from "better-sqlite3"
import { z } from "zod"
import { fullBookSourceCommitments } from "./full-book-source-accounting.ts"

export function fullBookSourcePreview(sqlite: Database.Database, owner: string, hash: string) {
  const commitments = fullBookSourceCommitments(sqlite, owner, hash)
  const { sourceVersion } = z
    .object({ sourceVersion: z.number().int().nonnegative() })
    .parse(
      sqlite
        .prepare(
          "SELECT COALESCE(MAX(v),0) AS sourceVersion FROM (SELECT budget_version AS v FROM full_book_consents WHERE owner_id=? AND source_hash=? UNION ALL SELECT budget_version AS v FROM full_book_imports WHERE owner_id=? AND source_hash=?)",
        )
        .get(owner, hash, owner, hash),
    )
  const counts = z
    .object({
      unknown: z.number().int().nonnegative(),
      pending: z.number().int().nonnegative(),
      awaitingOwner: z.number().int().nonnegative(),
      usageUnknown: z.number().int().nonnegative(),
    })
    .parse(
      sqlite
        .prepare(`WITH source_runs AS (
    SELECT run_id FROM live_study_scope_jobs WHERE owner_id=? AND source_hash=?
    UNION SELECT j.run_id FROM full_book_jobs j JOIN full_book_consents c ON c.id=j.consent_id WHERE c.owner_id=? AND c.source_hash=?
    UNION SELECT value FROM full_book_imports i,json_each(i.record_json,'$.runIds') WHERE i.owner_id=? AND i.source_hash=?)
    SELECT COALESCE(SUM(a.state='outcome_unknown'),0) AS unknown,COALESCE(SUM(a.state IN ('prepared','dispatching')),0) AS pending,COALESCE(SUM(a.state='outcome_unknown' AND json_extract(a.record_json,'$.resolution')='awaiting-owner'),0) AS awaitingOwner,COALESCE(SUM(json_extract(a.record_json,'$.usage.kind')='unknown'),0) AS usageUnknown
    FROM external_attempts a JOIN source_runs r ON r.run_id=a.run_id`)
        .get(owner, hash, owner, hash, owner, hash),
    )
  const { activeConsents } = z
    .object({ activeConsents: z.number().int().nonnegative() })
    .parse(
      sqlite
        .prepare(
          "SELECT COUNT(*) AS activeConsents FROM full_book_active_consents WHERE owner_id=? AND source_hash=?",
        )
        .get(owner, hash),
    )
  return { ...commitments, ...counts, sourceVersion, activeConsents }
}
