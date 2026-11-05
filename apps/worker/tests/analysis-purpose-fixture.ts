import { randomUUID } from "node:crypto"
import { rmSync } from "node:fs"
import { join } from "node:path"
import { StudySetupRevision, TransmissionGrant } from "@reading-studio/contracts"
import { BookMapPipeline, proposeNormalBatchedDraft } from "@reading-studio/generation"
import { ProviderRunner } from "@reading-studio/providers"
import { openStorage } from "@reading-studio/storage"
import { expect } from "vitest"
import { WorkerRuntime } from "../src/runtime.ts"
import {
  bookFixtureAuthority,
  bookFixtureCapacity,
  bookFixtureProvider,
  closeBookRoute,
} from "./book-map-route-fixture.ts"
import { BatchedRuntimeAdapter } from "./whole-book-batch-runtime-fixture.ts"
import { wholeBookFixture } from "./whole-book-fixture.ts"

export const evaluationPurpose = {
  version: "analysis-evaluation-1",
  terminal: "verified-analysis",
} as const
export async function analysisPurposeFixture(createGrant = true) {
  const original = await wholeBookFixture()
  let storage = original.storage,
    active = true
  const fixture = {
    ...original,
    databasePath: join(original.directory, "evaluation.sqlite"),
    get storage() {
      return storage
    },
    close: async () => {
      if (active) {
        await closeBookRoute(storage)
        storage.close()
        active = false
      }
      rmSync(original.directory, { recursive: true, force: true })
    },
  }
  const options = { databasePath: fixture.databasePath, privateDataRoot: fixture.privateDataRoot }
  try {
    const previous = storage.sources.getSetup("setup-whole")
    const normalization =
      previous && storage.sources.getNormalization(previous.analysis.normalizationRevisionId)
    if (!previous || !normalization) throw new TypeError("Missing synthetic source")
    const edition = storage.sources.getEdition(previous.editionId)
    if (!edition) throw new TypeError("Missing fixture edition")
    await closeBookRoute(storage)
    storage.close()
    active = false
    storage = openStorage(options)
    active = true
    storage.sources.createOwner("owner-1")
    storage.sources.createInstallation({ id: "installation-1", ownerId: "owner-1" })
    storage.sources.persistDocument({ edition, normalization })
    storage.sources.createStudy({
      id: "evaluation-study",
      ownerId: "owner-1",
      editionId: previous.editionId,
    })
    const parsed = StudySetupRevision.safeParse({
      ...previous,
      id: "evaluation-setup",
      studyId: "evaluation-study",
      analysis: {
        ...previous.analysis,
        purpose: evaluationPurpose,
        processing: {
          ...previous.analysis.processing,
          preprocessingVersion: "batched-room-5",
          synthesisVersion: "batched-original-check-4",
        },
      },
    })
    expect(parsed.success).toBe(true)
    if (!parsed.success) throw new TypeError("Missing explicit evaluation purpose")
    const proposal = await proposeNormalBatchedDraft({
      setup: parsed.data,
      normalization,
      capacity: bookFixtureCapacity,
      cap: 20,
      used: 0,
    })
    expect(proposal.kind, JSON.stringify(proposal)).toBe("ready")
    if (proposal.kind !== "ready")
      throw new TypeError(`Evaluation proposal refused: ${proposal.reason}`)
    const setup = storage.sources.appendSetup({ record: proposal.setup, parentRevisionId: null })
    const target = {
      authorizationId: randomUUID(),
      studyId: setup.studyId,
      setupRevisionId: setup.id,
      sourceHash: setup.analysis.editionHash,
      model: setup.analysis.model,
      purpose: evaluationPurpose,
      grantId: `grant-${setup.id}`,
      budgetId: randomUUID(),
      attemptLimit: 20,
    }
    async function reopen(bound = true) {
      if (active) {
        await closeBookRoute(storage)
        storage.close()
        active = false
      }
      storage = openStorage({ ...options, ...(bound ? { liveStudyTarget: target } : {}) })
      active = true
      bookFixtureAuthority(fixture)
      return storage
    }
    await reopen()
    const grant = TransmissionGrant.parse({
      id: target.grantId,
      kind: "active",
      setupRevisionId: setup.id,
      ownerId: "owner-1",
      installationId: "installation-1",
      categories: ["book-text", "derived-study-material"],
      approvedAt: "2026-10-23T00:00:00.000Z",
      destination: setup.analysis.destination,
      purpose: evaluationPurpose,
    })
    if (createGrant) storage.sources.appendGrant(grant)
    function runtime(adapter = new BatchedRuntimeAdapter()) {
      const authority = {
        ...bookFixtureAuthority(fixture),
        clock: () => new Date("2026-10-23T00:00:00.000Z"),
        attemptIdFactory: randomUUID,
      }
      const pipeline = new BookMapPipeline(authority)
      const worker = new WorkerRuntime({
        storage,
        clock: () => new Date("2026-10-23T00:00:00.000Z"),
        leaseDurationMs: 60000,
        tokenFactory: randomUUID,
        attemptIdFactory: () => randomUUID(),
        resolveStage: (job) => ({
          kind: "structured",
          runner: new ProviderRunner({
            ...authority,
            adapters: {
              "chatgpt-subscription": bookFixtureProvider({
                fixture,
                authority,
                job,
                authored: adapter,
              }),
            },
          }),
          request: pipeline.stage(job),
        }),
      })
      return { pipeline, worker, adapter }
    }
    return { fixture, setup, normalization, grant, target, options, reopen, runtime }
  } catch (error) {
    await fixture.close()
    throw error
  }
}
