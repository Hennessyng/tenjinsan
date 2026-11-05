import { randomUUID } from "node:crypto"
import {
  contentDigest,
  FullBookManagedConsent,
  FullBookTestConsent,
  PINNED_CODEX_BUILD,
} from "@reading-studio/contracts"
import {
  FullBookRecoveryAmendment,
  fullBookNativeReleased,
  fullBookNativeScope,
  RECOVERY_LOGGING_BINDING,
  requireRecoveryBinding,
} from "@reading-studio/storage/test-support"
import { expect, it } from "vitest"
import { fullBookSession } from "./full-book-test-fixture.ts"

it("validates historical native recovery bindings independently of active release authority", () => {
  // Given internally consistent synthetic historical records, without a client, database or live permission.
  const session = fullBookSession()
  const budget = FullBookTestConsent.parse({
    id: randomUUID(),
    version: "full-book-test-consent-1",
    transport: "synthetic-only-no-native-entry",
    ownerId: "synthetic-owner",
    studyId: "synthetic-study",
    setupRevisionId: "synthetic-setup",
    session,
    sourceCeiling: 32,
    acknowledgement: {
      coverage: session.input.normalization.coverage,
      omissions: session.input.normalization.omissions ?? [],
    },
    approvedAt: "2026-01-01T00:00:00.000Z",
  })
  const grant = FullBookManagedConsent.parse({
    id: randomUUID(),
    version: "full-book-managed-consent-1",
    purpose: "full-book-managed-experimental",
    budgetConsentId: budget.id,
    budgetBinding: contentDigest(JSON.stringify(budget)),
    policy: {
      version: "full-book-managed-policy-1",
      evidence: "experimental-app-bounded",
      build: {
        kind: "pinned-codex",
        binaryPath: "/synthetic/not-installed/codex",
        ...PINNED_CODEX_BUILD,
      },
      sampling: "provider-managed-no-overrides",
      legacySettingsRole: "planning-metadata-not-native-sampling",
      maxFrameBytes: 32000,
      collectorBytes: 128000,
      timeoutMs: 90000,
      warnings: [
        "downstream-input-unmeasured",
        "collector-not-output-token-enforcement",
        "interrupt-or-kill-may-leave-provider-usage-unknown",
        "experimental-not-a-route-certificate",
      ],
    },
    warningsAcknowledged: true,
    approvedAt: "2026-01-01T00:00:00.000Z",
  })
  const pair = { grant, budget }
  const record = FullBookRecoveryAmendment.parse({
    version: "first-map-recovery-1",
    id: randomUUID(),
    nativeConsentId: grant.id,
    budgetConsentId: budget.id,
    jobId: contentDigest("synthetic job"),
    runId: `fb-${contentDigest("synthetic job")}`,
    priorAttemptIds: [randomUUID(), randomUUID()],
    ordinal: 3,
    extraHold: 1,
    originalCeiling: 32,
    effectiveCeiling: 33,
    nativeBinding: contentDigest(JSON.stringify(grant)),
    budgetBinding: contentDigest(JSON.stringify(budget)),
    scopeBinding: contentDigest(JSON.stringify(fullBookNativeScope(pair))),
    loggingVersion: "protocol54-45-sites",
    loggingBinding: RECOVERY_LOGGING_BINDING,
    stopAfterResult: true,
    ownerDecision: "raise-ceiling-one-first-map-attempt",
    approvedAt: "2026-01-02T00:00:00.000Z",
  })
  // When/Then history remains readable while neither a matching pin nor caller tuple grants dispatch.
  expect(() => requireRecoveryBinding(pair, record)).not.toThrow()
  expect(fullBookNativeReleased(grant.policy.build, fullBookNativeScope(pair))).toBe(false)
  expect(() => requireRecoveryBinding(pair, { ...record, originalCeiling: 34 })).toThrow()
  expect(() =>
    requireRecoveryBinding(pair, { ...record, scopeBinding: contentDigest("foreign settings") }),
  ).toThrow()
})
