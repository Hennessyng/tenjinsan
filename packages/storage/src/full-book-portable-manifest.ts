import { contentDigest } from "@reading-studio/contracts"
import { BackupError, type Payload } from "./backup-schema.ts"
import { validateManagedAudit } from "./full-book-managed-audit.ts"
import {
  portableNumber as number,
  portableRows as rows,
  portableText as text,
} from "./full-book-portable-rows.ts"
import { FullBookAudit, FullBookImport } from "./full-book-portable-schema.ts"
import { validateFullBookAudit } from "./full-book-portable-validate.ts"

export function validateFullBookImports(payload: Payload) {
  const coveredRuns = new Set<string>(),
    coveredAttempts = new Set<string>(),
    consents = new Set<string>()
  for (const row of rows(payload, "full_book_imports")) {
    const meta = FullBookImport.parse(JSON.parse(text(row, "record_json")))
    if (
      meta.id !== row["id"] ||
      meta.sourceHash !== row["source_hash"] ||
      meta.spent !== number(row, "spent") ||
      meta.held !== row["held"] ||
      meta.consentId !== row["consent_id"] ||
      meta.studyId !== row["study_id"] ||
      meta.setupRevisionId !== row["setup_revision_id"] ||
      meta.budgetVersion !== row["budget_version"] ||
      consents.has(meta.consentId)
    )
      throw new BackupError("experimental import index")
    consents.add(meta.consentId)
    const blob = payload.blobs.find((blob) => blob.hash === meta.auditBlobHash)
    if (!blob) throw new BackupError("experimental audit blob missing")
    const bytes = Buffer.from(blob.bytes, "base64")
    if (contentDigest(bytes.toString("utf8")) !== meta.auditBlobHash)
      throw new BackupError("experimental audit blob digest")
    const audit = FullBookAudit.parse(JSON.parse(bytes.toString("utf8")))
    validateManagedAudit(audit)
    validateFullBookAudit(audit, meta, payload)
    for (const id of meta.runIds) {
      if (coveredRuns.has(id)) throw new BackupError("experimental run counted twice")
      coveredRuns.add(id)
    }
    for (const id of meta.attemptIds) {
      if (coveredAttempts.has(id)) throw new BackupError("experimental attempt counted twice")
      coveredAttempts.add(id)
    }
  }
  for (const run of rows(payload, "generation_runs"))
    if (text(run, "input_revision_id").startsWith("fb-input-") && !coveredRuns.has(text(run, "id")))
      throw new BackupError("experimental namespace missing historical index")
  for (const input of rows(payload, "input_revisions"))
    if (text(input, "id").startsWith("fb-input-") && !consents.has(text(input, "id").slice(9)))
      throw new BackupError("experimental input missing historical source barrier")
}
