import { randomUUID } from "node:crypto"
import {
  contentDigest,
  FullBookManagedConsent,
  FullBookManagedPolicy,
  FullBookTestConsent,
  PINNED_CODEX_BUILD,
  StudySetupRevision,
} from "@reading-studio/contracts"
import { managedFixture } from "./full-book-managed-fixture.ts"

export function nativeScopeFixture(newStudy = false) {
  const f = managedFixture("direct-children-2")
  let budget = f.budget
  let setup = StudySetupRevision.parse(f.setup)
  if (newStudy) {
    f.storage.fullBookConsent.close(budget.id, "Synthetic fixture replacement only")
    f.storage.sources.createStudy({
      id: "same-book-new-study",
      ownerId: budget.ownerId,
      editionId: setup.editionId,
    })
    setup = StudySetupRevision.parse({
      ...setup,
      id: "new-study-setup",
      studyId: "same-book-new-study",
    })
    f.storage.sources.appendSetup({ record: setup, parentRevisionId: null })
    budget = FullBookTestConsent.parse({
      ...budget,
      id: randomUUID(),
      studyId: setup.studyId,
      setupRevisionId: setup.id,
    })
    f.storage.fullBookConsent.approve(budget)
  }
  const policy = FullBookManagedPolicy.parse({
    ...f.grant.policy,
    build: {
      kind: "pinned-codex",
      binaryPath: f.grant.policy.build.binaryPath,
      ...PINNED_CODEX_BUILD,
    },
  })
  const grant = FullBookManagedConsent.parse({
    ...f.grant,
    budgetConsentId: budget.id,
    budgetBinding: contentDigest(JSON.stringify(budget)),
    policy,
    reviewAcknowledgement: {
      readableAndDerived: true,
      appBoundedNotProviderLimits: true,
      coverageAndOmissions: true,
      budgetAndUnknown: true,
      runtimeBinding: contentDigest(JSON.stringify(policy)),
      recipientBinding: contentDigest(JSON.stringify(budget.session.destination)),
      planBinding: contentDigest(JSON.stringify(budget.session.plan)),
      omissionsHash: contentDigest(JSON.stringify(budget.acknowledgement.omissions)),
      maxAttempts: budget.session.plan.maxAttempts,
      priorSpent: 0,
      priorUnknown: 0,
      priorUsageUnknown: 0,
      priorHeld: 0,
      sourceVersion: 0,
      sourceCeiling: budget.sourceCeiling,
      coverage: budget.acknowledgement.coverage,
      omissionCount: budget.acknowledgement.omissions.length,
      reviewBinding: contentDigest("synthetic review, not a trusted release"),
    },
  })
  f.storage.fullBookManagedConsents.approve(grant)
  return { ...f, grant, budget, setup }
}
