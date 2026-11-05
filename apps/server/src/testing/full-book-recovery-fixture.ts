import { randomUUID } from "node:crypto"
import {
  contentDigest,
  FullBookManagedConsent,
  FullBookTestConsent,
} from "@reading-studio/contracts"
import { registerSyntheticSubscriptionTool } from "@reading-studio/storage/test-support"
import { fullBookConsentInput, fullBookServerFixture } from "./full-book-run-fixture.ts"

export async function serverRecoveryFixture() {
  const f = fullBookServerFixture()
  const input = await fullBookConsentInput(f)
  const admitted = await f.post("consent", input)
  if (admitted.status !== 201) throw new TypeError("Synthetic admission failed")
  const original = f.storage.fullBookManagedConsents.read(input.submissionId)
  f.storage.fullBookConsent.close(
    original.budget.id,
    "Synthetic fixture uses an exact finite ceiling before calls",
  )
  const budget = FullBookTestConsent.parse({
    ...original.budget,
    id: randomUUID(),
    sourceCeiling: original.budget.session.plan.maxAttempts,
  })
  f.storage.fullBookConsent.approve(budget)
  const grant = FullBookManagedConsent.parse({
    ...original.grant,
    id: randomUUID(),
    budgetConsentId: budget.id,
    budgetBinding: contentDigest(JSON.stringify(budget)),
    reviewAcknowledgement: {
      ...original.grant.reviewAcknowledgement,
      sourceCeiling: budget.sourceCeiling,
    },
  })
  f.storage.fullBookManagedConsents.approve(grant)
  registerSyntheticSubscriptionTool(grant.policy.build.binaryPath)
  for (let ordinal = 1; ordinal <= 2; ordinal++) {
    const now = new Date().toISOString()
    const lease = f.storage.fullBookExecution.claim({
      consentId: budget.id,
      token: randomUUID(),
      now,
      expiresAt: new Date(Date.now() + 30000).toISOString(),
    })
    if (!lease) throw new TypeError("Missing synthetic lease")
    const prepared = f.storage.fullBookExecution.reserve({
      lease,
      now,
      threadId: "unstarted",
      rpcId: ordinal,
    })
    f.storage.fullBookExecution.beforeWrite({ lease, attemptId: prepared.attempt.id, now })
    f.storage.fullBookExecution.interrupt({ lease, attemptId: prepared.attempt.id })
    if (ordinal === 1)
      f.storage.fullBookExecution.resolve({ attemptId: prepared.attempt.id, decision: "retry" })
  }
  const amendment = f.storage.fullBookRecovery.prepare(grant.id, new Date().toISOString())
  return { ...f, grant, budget, amendment }
}
