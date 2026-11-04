import { FullBookConsentError } from "@reading-studio/contracts"
import { z } from "zod"
import type { StorageContext } from "./database.ts"

export function requireManagedAttempt(
  context: StorageContext,
  input: Readonly<{ budgetId: string; attemptId: string; now: string }>,
) {
  const row = z
    .object({
      consent_id: z.string(),
      target_hash: z.string(),
      token: z.string(),
      fence: z.number(),
      expires_at: z.string(),
      state: z.literal("dispatching"),
      record_json: z.string(),
    })
    .parse(
      context.sqlite
        .prepare(
          "SELECT j.consent_id,j.target_hash,j.token,j.fence,j.expires_at,a.state,w.record_json FROM external_attempts a JOIN full_book_jobs j ON j.run_id=a.run_id JOIN full_book_wires w ON w.attempt_id=a.id WHERE a.id=? AND j.state='running'",
        )
        .get(input.attemptId),
    )
  const binding = z
    .object({ leaseToken: z.string(), leaseFence: z.number() })
    .parse(JSON.parse(row.record_json))
  if (
    row.consent_id !== input.budgetId ||
    binding.leaseToken !== row.token ||
    binding.leaseFence !== row.fence ||
    Date.parse(input.now) >= Date.parse(row.expires_at)
  )
    throw new FullBookConsentError("authority")
  return row
}
