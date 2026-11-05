import { randomUUID } from "node:crypto"
import { contentDigest } from "@reading-studio/contracts"
import { z } from "zod"
import type { StorageContext } from "./database.ts"
import { FullBookExecutionError } from "./full-book-execution-contract.ts"
import { storedFullBookConsent } from "./full-book-execution-history.ts"
import type { FullBookManagedConsents } from "./full-book-managed-consent.ts"
import { requireRecoveryBinding } from "./full-book-recovery-binding.ts"
import { readFullBookRecovery } from "./full-book-recovery-read.ts"
import { FullBookRecoveryAmendment, RECOVERY_LOGGING_BINDING } from "./full-book-recovery-record.ts"
import { fullBookNativeReleased, fullBookNativeScope } from "./full-book-release.ts"
import { fullBookSourceCommitments } from "./full-book-source-accounting.ts"
import { assertSyntheticSubscriptionTool } from "./synthetic-transport.ts"
export class FullBookRecoveryRepository {
  constructor(
    private readonly context: StorageContext,
    private readonly grants: FullBookManagedConsents,
  ) {}
  prepare(nativeId: string, approvedAt: string): FullBookRecoveryAmendment {
    const pair = this.grants.read(nativeId)
    const job = z
      .object({ id: z.string(), run_id: z.string() })
      .parse(
        this.context.sqlite
          .prepare("SELECT id,run_id FROM full_book_jobs WHERE consent_id=? AND node_index=0")
          .get(pair.budget.id),
      )
    const ids = z
      .array(z.object({ id: z.uuid() }))
      .length(2)
      .parse(
        this.context.sqlite
          .prepare("SELECT id FROM external_attempts WHERE run_id=? ORDER BY reservation")
          .all(job.run_id),
      )
    const [first, second] = ids
    if (!first || !second) throw new FullBookExecutionError("state")
    return FullBookRecoveryAmendment.parse({
      version: "first-map-recovery-1",
      id: randomUUID(),
      nativeConsentId: nativeId,
      budgetConsentId: pair.budget.id,
      jobId: job.id,
      runId: job.run_id,
      priorAttemptIds: [first.id, second.id],
      ordinal: 3,
      extraHold: 1,
      originalCeiling: pair.budget.sourceCeiling,
      effectiveCeiling: pair.budget.sourceCeiling + 1,
      nativeBinding: contentDigest(JSON.stringify(pair.grant)),
      budgetBinding: contentDigest(JSON.stringify(pair.budget)),
      scopeBinding: contentDigest(JSON.stringify(fullBookNativeScope(pair))),
      loggingVersion: "protocol54-45-sites",
      loggingBinding: RECOVERY_LOGGING_BINDING,
      stopAfterResult: true,
      ownerDecision: "raise-ceiling-one-first-map-attempt",
      approvedAt,
    })
  }
  approve(value: unknown): FullBookRecoveryAmendment {
    const record = FullBookRecoveryAmendment.parse(value)
    return this.context.sqlite
      .transaction(() => {
        const pair = this.grants.read(record.nativeConsentId)
        if (this.inspect(pair.budget.id)) throw new FullBookExecutionError("state")
        const expected = {
          ...this.prepare(record.nativeConsentId, record.approvedAt),
          id: record.id,
        }
        if (JSON.stringify(FullBookRecoveryAmendment.parse(expected)) !== JSON.stringify(record))
          throw new FullBookExecutionError("binding")
        requireRecoveryBinding(pair, record)
        if (
          pair.grant.policy.build.kind === "pinned-codex" &&
          !fullBookNativeReleased(pair.grant.policy.build, fullBookNativeScope(pair))
        )
          throw new FullBookExecutionError("disabled")
        if (pair.grant.policy.build.kind === "fixture-not-live-evidence")
          assertSyntheticSubscriptionTool(pair.grant.policy.build.binaryPath)
        const budget = fullBookSourceCommitments(
          this.context.sqlite,
          pair.budget.ownerId,
          pair.budget.session.input.normalization.editionHash,
        )
        if (budget.spent !== 2 || budget.spent + budget.held !== record.originalCeiling)
          throw new FullBookExecutionError("budget")
        this.context.sqlite
          .prepare("INSERT INTO full_book_recoveries VALUES (?,?,?,?,?,?)")
          .run(
            record.id,
            record.budgetConsentId,
            record.nativeConsentId,
            record.jobId,
            record.effectiveCeiling,
            JSON.stringify(record),
          )
        return record
      })
      .immediate()
  }
  inspect(budgetId: string) {
    return readFullBookRecovery(
      this.context.sqlite,
      storedFullBookConsent(this.context.sqlite, budgetId),
    )
  }
}
