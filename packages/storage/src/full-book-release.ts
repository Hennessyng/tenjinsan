import {
  contentDigest,
  type FullBookManagedConsent,
  type FullBookManagedPolicy,
  type FullBookTestConsent,
  PINNED_CODEX_BUILD,
} from "@reading-studio/contracts"
export function fullBookNativeScope(
  pair: Readonly<{ grant: FullBookManagedConsent; budget: FullBookTestConsent }>,
) {
  const { grant, budget } = pair
  return Object.freeze({
    nativeConsentId: grant.id,
    budgetConsentId: budget.id,
    nativeBinding: contentDigest(JSON.stringify(grant)),
    budgetBinding: contentDigest(JSON.stringify(budget)),
    studyId: budget.studyId,
    setupId: budget.setupRevisionId,
    sourceHash: budget.session.input.normalization.editionHash,
    normalizationId: budget.session.input.normalization.id,
    inputBinding: contentDigest(JSON.stringify(budget.session.input)),
    recipientBinding: contentDigest(JSON.stringify(budget.session.destination)),
    model: budget.session.model,
    settingsBinding: contentDigest(JSON.stringify(budget.session.settings)),
    fence: budget.session.destination.connectionRevision,
    planBinding: contentDigest(JSON.stringify(budget.session.plan)),
    sourceCeiling: budget.sourceCeiling,
    hierarchyPolicy: budget.session.input.hierarchyPolicy ?? "legacy",
    acknowledgementBinding: contentDigest(JSON.stringify(budget.acknowledgement)),
    runtimeBinding: contentDigest(JSON.stringify(grant.policy)),
  })
}
export function fullBookNativeCompatible(build: FullBookManagedPolicy["build"]): boolean {
  return (
    build.kind === "pinned-codex" &&
    build.sha256 === PINNED_CODEX_BUILD.sha256 &&
    build.version === PINNED_CODEX_BUILD.version &&
    build.sourceCommit === PINNED_CODEX_BUILD.sourceCommit
  )
}
export function fullBookNativeReleased(
  _build: FullBookManagedPolicy["build"],
  _scope?: unknown,
): boolean {
  // Published composition has no native release authority; historical scope data cannot install it.
  return false
}
