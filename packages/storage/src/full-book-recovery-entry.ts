import { FullBookExecutionError } from "./full-book-execution-contract.ts"
import type { FullBookExecutionStore } from "./full-book-execution-store.ts"
import { FullBookManagedConsents } from "./full-book-managed-consent.ts"
import type { readFullBookRecovery } from "./full-book-recovery-read.ts"
import { fullBookNativeReleased, fullBookNativeScope } from "./full-book-release.ts"
export function authorizeRecoveryEntry(
  store: FullBookExecutionStore,
  recovery: NonNullable<ReturnType<typeof readFullBookRecovery>>,
) {
  const pair = new FullBookManagedConsents(store.context, store.consents).read(
    recovery.amendment.nativeConsentId,
  )
  if (
    pair.grant.policy.build.kind === "pinned-codex" &&
    !fullBookNativeReleased(pair.grant.policy.build, fullBookNativeScope(pair))
  )
    throw new FullBookExecutionError("disabled")
}
