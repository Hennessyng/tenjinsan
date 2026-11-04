import { randomUUID } from "node:crypto"
import { join } from "node:path"
import {
  assertNever,
  contentDigest,
  FullBookManagedConsent,
  FullBookTestConsent,
  FullBookTestSession,
  LocalSubscriptionSession,
  planFullBookTest,
  subscriptionDestination,
  wholeBookScope,
} from "@reading-studio/contracts"
import { FixtureDatabase as Database } from "@reading-studio/storage/test-support"
import { durableConsentFixture } from "./full-book-durable-fixture.ts"

export function managedFixture(hierarchyPolicy?: "direct-children-2") {
  const f = durableConsentFixture()
  const state = LocalSubscriptionSession.parse({
    status: "connected",
    generation: randomUUID(),
    connectionRevision: 1,
    billingRoute: "subscription-provider-managed",
    authUrl: null,
    expiresAt: null,
    catalog: "checked",
    account: { email: null, accountId: null, planType: "fixture", workspaceId: null },
    models: [{ model: "synthetic-model", label: "fixture" }],
  })
  const destination = subscriptionDestination(
    "chatgpt-subscription",
    f.consent.session.destination.installationId,
    state,
  )
  if (!destination) throw new TypeError("Missing fixture destination")
  const normalization = {
    ...f.consent.session.input.normalization,
    id: "opaque-native-source",
    resources: f.consent.session.input.normalization.resources.map((resource) => {
      switch (resource.status) {
        case "included":
          return {
            ...resource,
            blocks: resource.blocks.map((block) => ({
              ...block,
              text: block.text ? `FIXTURE_MARKER_${block.id}` : "",
            })),
          }
        case "excluded":
          return resource
        default:
          return assertNever(resource)
      }
    }),
  }
  f.storage.sources.appendNormalization({
    record: normalization,
    parentRevisionId: f.consent.session.input.normalization.id,
  })
  const input = {
    ...f.consent.session.input,
    ...(hierarchyPolicy ? { hierarchyPolicy } : {}),
    normalization,
    windows: f.consent.session.input.windows.map((window) =>
      window.map((span) => ({
        ...span,
        normalizationRevisionId: normalization.id,
        originalFragment: `FIXTURE_MARKER_${span.blockId}`,
        end: `FIXTURE_MARKER_${span.blockId}`.length,
      })),
    ),
  }
  const session = FullBookTestSession.parse({
    ...f.consent.session,
    destination,
    input,
    plan: planFullBookTest(input),
  })
  const setup = {
    ...f.setup,
    id: "managed-native-draft",
    analysis: {
      ...f.setup.analysis,
      normalizationRevisionId: normalization.id,
      destination,
      scope: wholeBookScope(session.input.normalization),
    },
  }
  f.storage.sources.appendSetup({ record: setup, parentRevisionId: f.setup.id })
  const budget = FullBookTestConsent.parse({ ...f.consent, session, setupRevisionId: setup.id })
  f.storage.fullBookConsent.approve(budget)
  const db = new Database(f.options.databasePath)
  try {
    db.pragma("foreign_keys = ON")
    db.pragma("recursive_triggers = ON")
    db.prepare(
      "INSERT INTO subscription_sessions(installation_id,provider,record_json) VALUES (?,'chatgpt-subscription',?)",
    ).run(destination.installationId, JSON.stringify(state))
  } finally {
    db.close()
  }
  const grant = FullBookManagedConsent.parse({
    id: randomUUID(),
    version: "full-book-managed-consent-1",
    purpose: "full-book-managed-experimental",
    budgetConsentId: budget.id,
    budgetBinding: contentDigest(JSON.stringify(budget)),
    warningsAcknowledged: true,
    approvedAt: budget.approvedAt,
    policy: {
      version: "full-book-managed-policy-1",
      evidence: "experimental-app-bounded",
      build: {
        kind: "fixture-not-live-evidence",
        binaryPath: join(f.options.privateDataRoot, "fake-appserver.mjs"),
        sha256: contentDigest("fixture executable"),
      },
      sampling: "provider-managed-no-overrides",
      legacySettingsRole: "planning-metadata-not-native-sampling",
      maxFrameBytes: budget.session.input.policy.maxAppBytes,
      collectorBytes: 128000,
      timeoutMs: 1000,
      warnings: [
        "downstream-input-unmeasured",
        "collector-not-output-token-enforcement",
        "interrupt-or-kill-may-leave-provider-usage-unknown",
        "experimental-not-a-route-certificate",
      ],
    },
  })
  return { ...f, budget, grant, state, setup }
}
