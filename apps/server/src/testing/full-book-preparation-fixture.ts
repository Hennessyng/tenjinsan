import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  contentDigest,
  FullBookTestConsent,
  FullBookTestSession,
  LocalSubscriptionSession,
  planFullBookTest,
  StudySetupRevision,
  subscriptionDestination,
  wholeBookScope,
} from "@reading-studio/contracts"
import { defaultSettings } from "@reading-studio/providers"
import { openStorage } from "@reading-studio/storage"
import { completeGraphFixtures, FixtureDatabase } from "@reading-studio/storage/test-support"

export function preparationFixture() {
  const directory = mkdtempSync(join(tmpdir(), "full-book-preparation-"))
  const storage = openStorage({
    databasePath: join(directory, "studio.sqlite"),
    privateDataRoot: join(directory, "private"),
  })
  const graph = completeGraphFixtures("openrouter")
  const normalization = {
    ...graph.normalization,
    id: "preparation-normalization",
    editionHash: contentDigest("opaque fixture"),
    coverage: "partial",
    omissions: Array.from({ length: 13 }, (_, i) => ({
      path: `excluded-${i}`,
      reason: "synthetic omission",
    })),
    resources: [
      {
        path: "synthetic-text",
        status: "included",
        role: "main-chapter",
        blocks: [
          { id: "a", text: "FIXTURE_MARKER_a" },
          { id: "anchor", text: "" },
        ],
      },
    ],
  }
  const state = LocalSubscriptionSession.parse({
    status: "connected",
    generation: "00000000-0000-4000-8000-000000000001",
    connectionRevision: 1,
    billingRoute: "subscription-provider-managed",
    authUrl: null,
    expiresAt: null,
    catalog: "checked",
    account: { accountId: "synthetic", workspaceId: null, email: null, planType: "fixture" },
    models: [{ model: "synthetic-model", label: "Fixture" }],
  })
  const destination = subscriptionDestination(
    "chatgpt-subscription",
    "preparation-installation",
    state,
  )
  if (!destination) throw new TypeError("Missing synthetic destination")
  const input = {
    version: "full-book-test-1",
    purpose: "experimental-analysis-only",
    routeEvidence: "experimental-app-guards-not-live-certificate",
    normalization,
    groups: [{ id: "group", blockIds: ["a", "anchor"] }],
    windows: [
      [
        {
          editionId: normalization.editionId,
          normalizationRevisionId: normalization.id,
          resourcePath: "synthetic-text",
          blockId: "a",
          start: 0,
          end: "FIXTURE_MARKER_a".length,
          originalFragment: "FIXTURE_MARKER_a",
        },
      ],
    ],
    policy: {
      fanout: 2,
      maxLevels: 2,
      maxFindings: 12,
      findingsPerBatch: 6,
      maxNodes: 100,
      maxAttempts: 100,
      maxAppBytes: 32000,
      maxOutputBytes: 16000,
      attemptsPerNode: 2,
    },
  }
  const session = FullBookTestSession.parse({
    enabled: true,
    purpose: "full-book-test-1",
    input,
    plan: planFullBookTest(input),
    destination,
    model: "synthetic-model",
    settings: defaultSettings,
  })
  storage.sources.createOwner("owner-1")
  storage.sources.createInstallation({ id: session.destination.installationId, ownerId: "owner-1" })
  storage.subscriptionConnections.disconnect(
    session.destination.installationId,
    "chatgpt-subscription",
  )
  storage.sources.appendEdition({
    id: normalization.editionId,
    originalHash: normalization.editionHash,
    originalBlobHash: normalization.editionHash,
    title: "Synthetic preparation",
  })
  storage.sources.appendNormalization({ record: normalization, parentRevisionId: null })
  storage.sources.createStudy({
    id: "preparation-study",
    ownerId: "owner-1",
    editionId: normalization.editionId,
  })
  const setup = StudySetupRevision.parse({
    ...graph.setup,
    id: "preparation-setup",
    studyId: "preparation-study",
    editionId: normalization.editionId,
    analysis: {
      ...graph.setup.analysis,
      editionHash: normalization.editionHash,
      normalizationRevisionId: normalization.id,
      provider: "chatgpt-subscription",
      destination: session.destination,
      model: session.model,
      settings: session.settings,
      scope: wholeBookScope(session.input.normalization),
    },
  })
  storage.sources.appendSetup({ record: setup, parentRevisionId: null })
  const budget = FullBookTestConsent.parse({
    id: "00000000-0000-4000-8000-000000000002",
    version: "full-book-test-consent-1",
    transport: "synthetic-only-no-native-entry",
    ownerId: "owner-1",
    studyId: setup.studyId,
    setupRevisionId: setup.id,
    session,
    sourceCeiling: 40,
    acknowledgement: { coverage: "partial", omissions: normalization.omissions },
    approvedAt: "2026-10-31T00:00:00.000Z",
  })
  storage.fullBookConsent.approve(budget)
  const db = new FixtureDatabase(join(directory, "studio.sqlite"))
  db.prepare(
    "INSERT INTO subscription_sessions(installation_id,provider,record_json) VALUES (?,'chatgpt-subscription',?)",
  ).run(session.destination.installationId, JSON.stringify(state))
  return {
    databasePath: join(directory, "studio.sqlite"),
    storage,
    setup,
    budget,
    state,
    setCachedSession(value: LocalSubscriptionSession) {
      db.prepare("UPDATE subscription_sessions SET record_json=?").run(JSON.stringify(value))
    },
    clearCachedSession() {
      db.prepare("DELETE FROM subscription_sessions").run()
    },
    cleanup() {
      db.close()
      storage.close()
      rmSync(directory, { recursive: true, force: true })
    },
  }
}
