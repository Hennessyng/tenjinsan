import { randomUUID } from "node:crypto"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import {
  contentDigest,
  FullBookTestConsent,
  FullBookTestSession,
  planFullBookTest,
  StudySetupRevision,
  wholeBookScope,
} from "@reading-studio/contracts"
import { openStorage } from "@reading-studio/storage"
import { completeGraphFixtures } from "@reading-studio/storage/test-support"
import { fullBookSession } from "./full-book-test-fixture.ts"

export function durableConsentFixture() {
  const directory = mkdtempSync(join(tmpdir(), "full-book-consent-"))
  const options = {
    databasePath: join(directory, "studio.sqlite"),
    privateDataRoot: join(directory, "private"),
  }
  const storage = openStorage(options),
    initial = fullBookSession()
  const normalization = {
    ...initial.input.normalization,
    editionHash: contentDigest("Synthetic durable source bytes"),
    coverage: "partial",
    omissions: Array.from({ length: 13 }, (_, i) => ({
      path: `omission-${i}`,
      reason: `Synthetic omission ${i}`,
    })),
  }
  const input = { ...initial.input, normalization }
  const session = FullBookTestSession.parse({ ...initial, input, plan: planFullBookTest(input) })
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
    title: "Synthetic durable source",
  })
  const sourcePath = storage.blobs.pathFor(normalization.editionHash)
  mkdirSync(dirname(sourcePath), { recursive: true })
  writeFileSync(sourcePath, "Synthetic durable source bytes", { mode: 0o600 })
  storage.sources.appendNormalization({ record: normalization, parentRevisionId: null })
  storage.sources.createStudy({
    id: "full-book-study",
    ownerId: "owner-1",
    editionId: normalization.editionId,
  })
  const graph = completeGraphFixtures("openrouter")
  const setup = StudySetupRevision.parse({
    ...graph.setup,
    id: "full-book-draft",
    studyId: "full-book-study",
    editionId: normalization.editionId,
    analysis: {
      ...graph.setup.analysis,
      editionHash: normalization.editionHash,
      normalizationRevisionId: normalization.id,
      provider: "chatgpt-subscription",
      model: session.model,
      destination: session.destination,
      settings: session.settings,
      scope: wholeBookScope(session.input.normalization),
    },
  })
  storage.sources.appendSetup({ record: setup, parentRevisionId: null })
  const consent = FullBookTestConsent.parse({
    id: randomUUID(),
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
  let closed = false
  const closeStorage = () => {
    if (!closed) {
      closed = true
      storage.close()
    }
  }
  return {
    storage,
    options,
    consent,
    setup,
    closeStorage,
    cleanup() {
      closeStorage()
      rmSync(directory, { recursive: true, force: true })
    },
  }
}
