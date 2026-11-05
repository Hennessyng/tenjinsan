import {
  contentDigest,
  FullBookConsentError,
  type FullBookManagedConsent,
  type FullBookTestConsent,
} from "@reading-studio/contracts"

export function validateManagedReview(grant: FullBookManagedConsent, budget: FullBookTestConsent) {
  const review = grant.reviewAcknowledgement,
    session = budget.session
  if (!review) return
  if (
    session.input.hierarchyPolicy !== "direct-children-2" ||
    review.runtimeBinding !== contentDigest(JSON.stringify(grant.policy)) ||
    review.planBinding !== contentDigest(JSON.stringify(session.plan)) ||
    review.recipientBinding !== contentDigest(JSON.stringify(session.destination)) ||
    review.omissionsHash !==
      contentDigest(JSON.stringify(session.input.normalization.omissions ?? [])) ||
    review.maxAttempts !== session.plan.maxAttempts ||
    review.sourceCeiling !== budget.sourceCeiling ||
    review.coverage !== session.input.normalization.coverage ||
    review.omissionCount !== (session.input.normalization.omissions ?? []).length
  )
    throw new FullBookConsentError("authority")
}
