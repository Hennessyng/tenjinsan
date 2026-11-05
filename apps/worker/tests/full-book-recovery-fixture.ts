import { randomUUID } from "node:crypto"
import {
  contentDigest,
  FullBookManagedConsent,
  FullBookTestConsent,
} from "@reading-studio/contracts"
import { executionClock as clock } from "./full-book-execution-fixture.ts"
import { managedProcess } from "./full-book-managed-process-fixture.ts"

export function recoveryFixture() {
  const f = managedProcess("complete", "direct-children-2")
  f.storage.fullBookConsent.close(
    f.budget.id,
    "Disposable fixture switches to exact finite ceiling before any attempt",
  )
  const budget = FullBookTestConsent.parse({
    ...f.budget,
    id: randomUUID(),
    sourceCeiling: f.budget.session.plan.maxAttempts,
  })
  f.storage.fullBookConsent.approve(budget)
  const grant = FullBookManagedConsent.parse({
    ...f.grant,
    id: randomUUID(),
    budgetConsentId: budget.id,
    budgetBinding: contentDigest(JSON.stringify(budget)),
    reviewAcknowledgement: {
      readableAndDerived: true,
      appBoundedNotProviderLimits: true,
      coverageAndOmissions: true,
      budgetAndUnknown: true,
      runtimeBinding: contentDigest(JSON.stringify(f.grant.policy)),
      recipientBinding: contentDigest(JSON.stringify(budget.session.destination)),
      planBinding: contentDigest(JSON.stringify(budget.session.plan)),
      omissionsHash: contentDigest(JSON.stringify(budget.acknowledgement.omissions)),
      maxAttempts: budget.session.plan.maxAttempts,
      priorSpent: 0,
      priorUnknown: 0,
      priorUsageUnknown: 0,
      priorHeld: 0,
      sourceVersion: 1,
      sourceCeiling: budget.sourceCeiling,
      coverage: budget.acknowledgement.coverage,
      omissionCount: budget.acknowledgement.omissions.length,
      reviewBinding: contentDigest("synthetic recovery review, never native authority"),
    },
  })
  f.storage.fullBookManagedConsents.approve(grant)
  for (let ordinal = 1; ordinal <= 2; ordinal++) {
    const lease = f.storage.fullBookExecution.claim({
      consentId: budget.id,
      token: randomUUID(),
      now: clock.now,
      expiresAt: clock.expiresAt,
    })
    if (!lease) throw new TypeError("Missing synthetic lease")
    const prepared = f.storage.fullBookExecution.reserve({
      lease,
      now: clock.now,
      threadId: "unstarted",
      rpcId: ordinal,
    })
    f.storage.fullBookExecution.beforeWrite({
      lease,
      attemptId: prepared.attempt.id,
      now: clock.now,
    })
    f.storage.fullBookExecution.interrupt({ lease, attemptId: prepared.attempt.id })
    if (ordinal === 1)
      f.storage.fullBookExecution.resolve({ attemptId: prepared.attempt.id, decision: "retry" })
  }
  const amendment = f.storage.fullBookRecovery.prepare(grant.id, clock.now)
  return { ...f, budget, grant, amendment }
}
