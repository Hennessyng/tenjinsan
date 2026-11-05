import { randomUUID } from "node:crypto"
import {
  contentDigest,
  FullBookAcknowledgements,
  FullBookConsentError,
  FullBookManagedConsent,
  FullBookTestConsent,
} from "@reading-studio/contracts"
import type { Storage } from "@reading-studio/storage"
import { z } from "zod"
import { FullBookPreparationError, FullBookPreparationOptions } from "./full-book-preparation.ts"
import { reviewFullBook } from "./full-book-review.ts"
import { fullBookRunState } from "./full-book-run-state.ts"
import { type FullBookServerRuntime, inspectFullBookRuntime } from "./full-book-runtime.ts"

export const FullBookAdmissionInput = z.strictObject({
  submissionId: z.uuid(),
  options: FullBookPreparationOptions,
  reviewBinding: z.string(),
  acknowledgements: FullBookAcknowledgements,
})
export function admitFullBook(
  deps: Readonly<{ storage: Storage; runtime: FullBookServerRuntime | undefined }>,
  scope: Readonly<{ owner: string; setupId: string }>,
  raw: unknown,
) {
  const input = FullBookAdmissionInput.parse(raw),
    s = deps.storage
  return s.atomicWrite(() => {
    if (
      s.fullBookManagedConsents
        .history(scope.owner, scope.setupId)
        .some((record) => record.grant.id === input.submissionId)
    )
      throw new FullBookConsentError("active")
    const reviewed = reviewFullBook(deps, scope, input.options),
      runtime = reviewed.runtime
    if (!runtime || !reviewed.summary.consent) throw new FullBookConsentError("disabled")
    if (reviewed.reviewBinding !== input.reviewBinding)
      throw new FullBookPreparationError("review-stale")
    const expected = reviewed.summary.consent
    for (const key of [
      "runtimeBinding",
      "recipientBinding",
      "planBinding",
      "omissionsHash",
      "maxAttempts",
      "priorSpent",
      "priorUnknown",
      "priorUsageUnknown",
      "priorHeld",
      "sourceVersion",
      "sourceCeiling",
      "coverage",
      "omissionCount",
    ] as const)
      if (input.acknowledgements[key] !== expected[key]) throw new FullBookConsentError("authority")
    if (!reviewed.summary.budget.fits) throw new FullBookConsentError("budget")
    if (reviewed.summary.budget.pending || reviewed.summary.budget.awaitingOwner)
      throw new FullBookConsentError("inflight")
    const approvedAt = new Date().toISOString()
    const budget = FullBookTestConsent.parse({
      id: randomUUID(),
      version: "full-book-test-consent-1",
      transport: "synthetic-only-no-native-entry",
      ownerId: scope.owner,
      studyId: reviewed.setup.studyId,
      setupRevisionId: reviewed.setup.id,
      session: reviewed.session,
      sourceCeiling: input.options.sourceCeiling,
      acknowledgement: {
        coverage: reviewed.session.input.normalization.coverage,
        omissions: reviewed.session.input.normalization.omissions ?? [],
      },
      approvedAt,
    })
    const admitted = s.fullBookConsent.approve(budget)
    const grant = FullBookManagedConsent.parse({
      id: input.submissionId,
      version: "full-book-managed-consent-1",
      purpose: "full-book-managed-experimental",
      budgetConsentId: budget.id,
      budgetBinding: contentDigest(JSON.stringify(budget)),
      policy: runtime.policy,
      warningsAcknowledged: true,
      reviewAcknowledgement: { ...input.acknowledgements, reviewBinding: input.reviewBinding },
      approvedAt,
    })
    s.fullBookManagedConsents.approve(grant)
    s.fullBookManagedConsents.read(grant.id)
    const after = s.fullBookConsent.preview(
      scope.owner,
      budget.session.input.normalization.editionHash,
    )
    if (
      admitted.spent !== input.acknowledgements.priorSpent ||
      after.spent !== input.acknowledgements.priorSpent ||
      after.unknown !== input.acknowledgements.priorUnknown ||
      after.usageUnknown !== input.acknowledgements.priorUsageUnknown ||
      after.held !== reviewed.summary.budget.held + budget.session.plan.maxAttempts ||
      after.sourceVersion !== admitted.budgetVersion
    )
      throw new FullBookPreparationError("review-stale")
    if (inspectFullBookRuntime(deps.runtime, input.options)?.binding !== runtime.binding)
      throw new FullBookConsentError("authority")
    return fullBookRunState(s, { ...scope, id: grant.id })
  })
}
