import { FullBookConsentError, FullBookManagedConsent } from "@reading-studio/contracts"
import { z } from "zod"
import { BackupError } from "./backup-schema.ts"
import type { StorageContext } from "./database.ts"
import { storedFullBookConsent } from "./full-book-execution-history.ts"
import { FullBookJobRow } from "./full-book-execution-store.ts"
import { captureFullBookAudits } from "./full-book-portable-capture.ts"
import { readFullBookRecovery } from "./full-book-recovery-read.ts"

export function inspectManagedConsent(
  context: StorageContext,
  scope: Readonly<{ id: string; owner: string; setupId: string }>,
) {
  const row = z
    .object({ record_json: z.string() })
    .safeParse(
      context.sqlite
        .prepare("SELECT record_json FROM full_book_managed_consents WHERE id=?")
        .get(scope.id),
    )
  if (!row.success) throw new FullBookConsentError("authority")
  const grant = FullBookManagedConsent.parse(JSON.parse(row.data.record_json)),
    budget = storedFullBookConsent(context.sqlite, grant.budgetConsentId)
  if (
    budget.ownerId !== scope.owner ||
    budget.setupRevisionId !== scope.setupId ||
    grant.id !== scope.id
  )
    throw new FullBookConsentError("authority")
  const { notNeededNodes } = z
    .object({ notNeededNodes: z.number().int().nonnegative() })
    .parse(
      context.sqlite
        .prepare("SELECT COUNT(*) AS notNeededNodes FROM full_book_not_needed WHERE consent_id=?")
        .get(budget.id),
    )
  return {
    notNeededNodes,
    recovery: readFullBookRecovery(context.sqlite, budget),
    grant,
    budget,
    revoked: Boolean(
      context.sqlite
        .prepare("SELECT 1 FROM full_book_managed_revocations WHERE consent_id=?")
        .get(grant.id),
    ),
    closed: Boolean(
      context.sqlite
        .prepare("SELECT 1 FROM full_book_consent_closures WHERE consent_id=?")
        .get(budget.id),
    ),
    jobs: z
      .array(FullBookJobRow)
      .parse(
        context.sqlite
          .prepare("SELECT * FROM full_book_jobs WHERE consent_id=? ORDER BY node_index")
          .all(budget.id),
      ),
  }
}
export function managedConsentHistory(context: StorageContext, owner: string, setupId: string) {
  return z
    .array(z.object({ id: z.string() }))
    .parse(
      context.sqlite
        .prepare(
          "SELECT n.id FROM full_book_managed_consents n JOIN full_book_consents c ON c.id=n.budget_consent_id WHERE c.owner_id=? AND c.setup_revision_id=? ORDER BY n.rowid DESC",
        )
        .all(owner, setupId),
    )
    .map(({ id }) => inspectManagedConsent(context, { id, owner, setupId }))
}
export function exportManagedHistory(
  context: StorageContext,
  scope: Readonly<{ id: string; owner: string; setupId: string }>,
) {
  try {
    return context.sqlite.transaction(() => {
      const record = inspectManagedConsent(context, scope)
      if (!record.closed) throw new FullBookConsentError("active")
      const audit = captureFullBookAudits(context.sqlite, record.budget.id).find(
        (item) => item.meta.consentId === record.budget.id,
      )
      if (!audit) throw new FullBookConsentError("authority")
      return audit.bytes
    })()
  } catch (error) {
    if (error instanceof BackupError) throw new FullBookConsentError("inflight")
    throw error
  }
}
