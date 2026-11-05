import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import {
  COVERAGE_VERIFICATION_VERSION,
  EXPERIMENTAL_COVERAGE_OPT_IN_VERSION,
  LOCAL_CHATGPT_INFERENCE_POLICY,
  StudySetupRevision,
  wholeBookScope,
} from "@reading-studio/contracts"
import {
  prepareBookMapScope,
  storedBookPlan,
  wholeBookFeasibility,
} from "@reading-studio/generation"
import { defaultSettings } from "@reading-studio/providers"
import { openStorage } from "@reading-studio/storage"
import { completeGraphFixtures } from "@reading-studio/storage/test-support"
import {
  bookFixtureCapacity,
  closeBookRoute,
} from "../../../apps/worker/tests/book-map-route-fixture.ts"
import type { extract } from "./corpus-support.ts"
import { prepareBookRoute } from "./portable-fixtures.ts"
export type SourcePolicy = {
  readonly synthesisVersion?: typeof COVERAGE_VERIFICATION_VERSION
  readonly draftOnly?: true
}

export async function persistedSource(
  bytes: Uint8Array,
  extracted: Awaited<ReturnType<typeof extract>>,
  policy: SourcePolicy = {},
) {
  const directory = mkdtempSync(join(tmpdir(), "ten29-pipeline-"))
  const databasePath = join(directory, "studio.sqlite")
  const privateDataRoot = join(directory, "private")
  const storage = openStorage({ databasePath, privateDataRoot })
  const blob = storage.blobs.pathFor(extracted.edition.originalBlobHash)
  mkdirSync(dirname(blob), { recursive: true, mode: 0o700 })
  writeFileSync(blob, bytes, { mode: 0o600 })
  const graph = completeGraphFixtures("openrouter")
  storage.sources.createOwner("owner-1")
  storage.sources.createInstallation({ id: "installation-1", ownerId: "owner-1" })
  storage.sources.appendEdition(extracted.edition)
  storage.sources.createStudy({
    id: "study-1",
    ownerId: "owner-1",
    editionId: extracted.edition.id,
  })
  storage.sources.appendNormalization({ record: extracted.normalization, parentRevisionId: null })
  let proposal = StudySetupRevision.parse({
    ...graph.setup,
    ...(policy.synthesisVersion === COVERAGE_VERIFICATION_VERSION
      ? {
          experimentalCoverageOptIn: {
            version: EXPERIMENTAL_COVERAGE_OPT_IN_VERSION,
            enabled: true,
          },
        }
      : {}),
    id: "setup-whole",
    editionId: extracted.edition.id,
    analysis: {
      ...graph.setup.analysis,
      editionHash: extracted.edition.originalHash,
      normalizationRevisionId: extracted.normalization.id,
      scope: wholeBookScope(extracted.normalization),
      provider: "chatgpt-subscription",
      model: bookFixtureCapacity.model,
      destination: bookFixtureCapacity.destination,
      analysisPromptVersion: "whole-book-2",
      analysisSchemaVersion: "whole-book-2",
      processing: {
        preprocessingVersion: "packed-capacity-3",
        synthesisVersion: policy.synthesisVersion ?? "maps-original-check-2",
        inferencePolicyVersion: LOCAL_CHATGPT_INFERENCE_POLICY,
        capacityId: bookFixtureCapacity.id,
      },
      settings: policy.draftOnly ? defaultSettings : graph.setup.analysis.settings,
    },
  })
  if (policy.synthesisVersion === COVERAGE_VERIFICATION_VERSION) {
    const bounded = prepareBookMapScope(
      StudySetupRevision.parse({
        ...proposal,
        analysis: {
          ...proposal.analysis,
          processing: { ...proposal.analysis.processing, preprocessingVersion: "packed-unicode-2" },
        },
      }),
      extracted.normalization,
    )
    if (bounded.kind !== "ready")
      throw new TypeError("Explicit fixture plan unavailable before grant")
    proposal = StudySetupRevision.parse({
      ...proposal,
      analysis: {
        ...proposal.analysis,
        processing: { ...proposal.analysis.processing, plan: storedBookPlan(bounded.windows) },
      },
    })
  }
  const prepared = await wholeBookFeasibility({
    setup: proposal,
    normalization: extracted.normalization,
    capacity: bookFixtureCapacity,
    cap: 64,
    used: 0,
    ...(policy.synthesisVersion === COVERAGE_VERIFICATION_VERSION
      ? { allowExperimentalCoverage: true as const }
      : {}),
  })
  if (prepared.kind !== "ready")
    throw new TypeError(`Synthetic plan blocked: ${prepared.failure.coverage.reason}`)
  const setup = storage.sources.appendSetup({
    record: {
      ...proposal,
      analysis: {
        ...proposal.analysis,
        processing: { ...proposal.analysis.processing, plan: storedBookPlan(prepared.windows) },
      },
    },
    parentRevisionId: null,
  })
  if (!policy.draftOnly)
    storage.sources.appendGrant({
      ...graph.grant,
      id: "grant-whole",
      setupRevisionId: setup.id,
      categories: ["book-text", "derived-study-material", "reader-context"],
      destination: bookFixtureCapacity.destination,
    })
  if (!policy.draftOnly) prepareBookRoute({ directory, storage })
  return {
    directory,
    databasePath,
    privateDataRoot,
    storage,
    ...extracted,
    setup,
    close: async () => {
      await closeBookRoute(storage)
      storage.close()
      rmSync(directory, { recursive: true, force: true })
    },
  }
}
