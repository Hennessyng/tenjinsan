import { FullBookConsentError, Usage } from "@reading-studio/contracts"
import { z } from "zod"
import type { StorageContext } from "./database.ts"
import { ManagedDiagnostic } from "./full-book-managed-diagnostic.ts"
export function recordManagedFailure(
  context: StorageContext,
  input: Readonly<{ id: string; attemptId: string; value: unknown }>,
) {
  const evidence = z
    .strictObject({
      reason: z.string(),
      observedUsage: Usage,
      collectedBytes: z.number().int().nonnegative(),
      partialAccepted: z.literal(false),
      diagnostic: ManagedDiagnostic.optional(),
    })
    .parse(input.value)
  const pair = z
    .object({ budget_consent_id: z.string(), consent_id: z.string() })
    .parse(
      context.sqlite
        .prepare(
          "SELECT n.budget_consent_id,j.consent_id FROM full_book_managed_consents n JOIN full_book_jobs j JOIN external_attempts a ON a.run_id=j.run_id WHERE n.id=? AND a.id=?",
        )
        .get(input.id, input.attemptId),
    )
  if (pair.budget_consent_id !== pair.consent_id) throw new FullBookConsentError("authority")
  context.sqlite
    .prepare("INSERT INTO full_book_managed_failures VALUES (?,?,?)")
    .run(input.attemptId, input.id, JSON.stringify(evidence))
}
export function revokeManagedConsent(context: StorageContext, id: string, reason: string) {
  context.sqlite
    .prepare("INSERT INTO full_book_managed_revocations VALUES (?,?)")
    .run(z.uuid().parse(id), z.string().trim().min(1).parse(reason))
}
