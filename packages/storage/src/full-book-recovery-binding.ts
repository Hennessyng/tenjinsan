import {
  contentDigest,
  type FullBookManagedConsent,
  type FullBookTestConsent,
} from "@reading-studio/contracts"
import { FullBookExecutionError } from "./full-book-execution-contract.ts"
import type { FullBookRecoveryAmendment } from "./full-book-recovery-record.ts"
import { fullBookNativeScope } from "./full-book-release.ts"
export function requireRecoveryBinding(
  pair: Readonly<{ grant: FullBookManagedConsent; budget: FullBookTestConsent }>,
  record: FullBookRecoveryAmendment,
) {
  if (
    record.nativeConsentId !== pair.grant.id ||
    record.budgetConsentId !== pair.budget.id ||
    record.nativeBinding !== contentDigest(JSON.stringify(pair.grant)) ||
    record.budgetBinding !== contentDigest(JSON.stringify(pair.budget)) ||
    record.scopeBinding !== contentDigest(JSON.stringify(fullBookNativeScope(pair))) ||
    record.originalCeiling !== pair.budget.sourceCeiling
  )
    throw new FullBookExecutionError("binding")
}
