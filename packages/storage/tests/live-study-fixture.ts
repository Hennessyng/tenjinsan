import { randomUUID } from "node:crypto"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { contentDigest, type Job, LOCAL_CHATGPT_INFERENCE_POLICY } from "@reading-studio/contracts"
import { openStorage, type Storage } from "../src/index.ts"
import { completeGraphFixtures } from "./fixtures.ts"

export const guardNow = "2026-01-01T00:00:01.000Z"
export function liveStudyFixture(withBlobs = false, reviewedLive = false) {
  const directory = mkdtempSync(join(tmpdir(), "ten27-live-guard-"))
  const options = {
    databasePath: join(directory, "studio.sqlite"),
    privateDataRoot: join(directory, "private"),
  }
  let storage = openStorage(options)
  const graph = completeGraphFixtures("openrouter")
  const blob = (text: string) => {
    const hash = contentDigest(text)
    const path = storage.blobs.pathFor(hash)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, text)
    return hash
  }
  const liveHash = withBlobs ? blob("Synthetic live source") : graph.edition.originalHash
  const oldHash = withBlobs ? blob("Synthetic historical source") : "b".repeat(64)
  storage.sources.createOwner("owner-1")
  storage.sources.createInstallation({ id: "installation-1", ownerId: "owner-1" })
  storage.sources.persistDocument({
    edition: { ...graph.edition, originalHash: liveHash, originalBlobHash: liveHash },
    normalization: { ...graph.normalization, editionHash: liveHash },
  })
  storage.sources.persistDocument({
    edition: {
      ...graph.edition,
      id: "edition-old",
      originalHash: oldHash,
      originalBlobHash: oldHash,
    },
    normalization: {
      ...graph.normalization,
      id: "normalization-old",
      editionId: "edition-old",
      editionHash: oldHash,
    },
  })
  for (const name of ["old", "live"]) {
    storage.sources.createStudy({
      id: `study-${name}`,
      ownerId: "owner-1",
      editionId: name === "old" ? "edition-old" : graph.edition.id,
    })
    storage.sources.appendSetup({
      record: {
        ...graph.setup,
        id: `setup-${name}`,
        studyId: `study-${name}`,
        editionId: name === "old" ? "edition-old" : graph.edition.id,
        analysis: {
          ...graph.setup.analysis,
          editionHash: liveHash,
          analysisPromptVersion: "analysis-1",
          analysisSchemaVersion: "analysis-1",
          ...(name === "old"
            ? {
                editionHash: oldHash,
                normalizationRevisionId: "normalization-old",
                provider: "openrouter",
                model: "gpt-4.1-mini",
              }
            : {
                provider: "chatgpt-subscription",
                model: "gpt-6-luna",
                ...(reviewedLive
                  ? {
                      analysisPromptVersion: "whole-book-2",
                      analysisSchemaVersion: "whole-book-2",
                      processing: {
                        inferencePolicyVersion: LOCAL_CHATGPT_INFERENCE_POLICY,
                        preprocessingVersion: "packed-capacity-3",
                        synthesisVersion: "maps-original-check-2",
                        capacityId: "synthetic-guard-only",
                      },
                    }
                  : {}),
                destination: {
                  provider: "chatgpt-subscription",
                  accountId: "synthetic-generation-live",
                  workspaceId: null,
                  installationId: "installation-1",
                  connectionRevision: 1,
                  billingRoute: "subscription-provider-managed",
                  executionPolicy: "tool-managed-v1",
                },
              }),
        },
      },
      parentRevisionId: null,
    })
  }
  const target = {
    authorizationId: randomUUID(),
    studyId: "study-live",
    setupRevisionId: "setup-live",
    model: "gpt-6-luna",
    sourceHash: liveHash,
  }
  function reopen(liveStudyTarget?: unknown) {
    const next = openStorage({
      ...options,
      ...(liveStudyTarget === undefined ? {} : { liveStudyTarget }),
    })
    storage.close()
    storage = next
    return storage
  }
  function queue(name: "old" | "live", count: number, maxCalls = 2) {
    const setupId = `setup-${name}`
    const inputRevisionId = storage.workflow.ensureAnalysisInput(setupId)
    const grant =
      storage.sources.getGrant(`grant-${name}`) ??
      storage.sources.appendGrant({
        ...graph.grant,
        id: `grant-${name}`,
        setupRevisionId: setupId,
        destination: storage.sources.getSetup(setupId)?.analysis.destination,
      })
    const result: Job[] = []
    for (let index = 0; index < count; index++) {
      const id = `${name}-${index}`
      storage.execution.appendRun({
        id,
        inputRevisionId,
        budget: { maxCalls },
        reservedCalls: 0,
        state: "running",
      })
      const setup = storage.sources.getSetup(setupId)
      if (!setup) throw new TypeError("Synthetic setup missing")
      result.push(
        storage.execution.appendJob({
          ...graph.job,
          id,
          runId: id,
          inputRevisionId,
          setupRevisionId: setupId,
          grant,
          provider: setup.analysis.provider,
          model: setup.analysis.model,
          stage: "analysis",
          state: "queued",
        }),
      )
    }
    return result
  }
  function claim() {
    const job = storage.execution.claimNextJob({
      token: randomUUID(),
      now: guardNow,
      expiresAt: "2026-01-01T01:00:00.000Z",
    })
    if (job?.state !== "running") throw new TypeError("Synthetic claim missing")
    return { jobId: job.id, token: job.lease.token, fence: job.lease.fence, now: guardNow }
  }
  function reserve(lease: ReturnType<typeof claim>) {
    return storage.execution.reserveAttempt({
      ...lease,
      attemptId: randomUUID(),
      preparedAt: guardNow,
    })
  }
  function complete(lease: ReturnType<typeof claim>) {
    return storage.execution.completeJob({
      ...lease,
      resultHash: contentDigest("synthetic complete"),
    })
  }
  return {
    directory,
    options,
    target,
    get storage(): Storage {
      return storage
    },
    reopen,
    queue,
    claim,
    reserve,
    complete,
    close: () => {
      storage.close()
      rmSync(directory, { recursive: true, force: true })
    },
  }
}
