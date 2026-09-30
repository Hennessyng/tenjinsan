import { randomUUID } from "node:crypto"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  generationStage,
  queueGenerationStage,
  saveGenerationStage,
} from "@reading-studio/generation/provider-stages"
import { ProviderAdapter, ProviderRunner } from "@reading-studio/providers"
import { openStorage } from "@reading-studio/storage"
import { completeGraphFixtures } from "@reading-studio/storage/test-support"
import { expect, it } from "vitest"
import { WorkerRuntime } from "../src/runtime.ts"
import { lessonFixture } from "./lesson-fixture.ts"
import { providerWire } from "./providers-wire.ts"

it("pauses an unknown section attempt across lease expiry without another paid call", async () => {
  const directory = mkdtempSync(join(tmpdir(), "provider-section-unknown-"))
  const paths = {
    databasePath: join(directory, "studio.sqlite"),
    privateDataRoot: join(directory, "private"),
  }
  let storage = openStorage(paths)
  const wire = await providerWire(["disconnect"])
  try {
    const fixture = lessonFixture(storage, "gpt-4.1-mini")
    storage.sources.appendGrant({
      ...completeGraphFixtures().grant,
      categories: ["book-text", "derived-study-material", "reader-context"],
    })
    storage.outlines.decide({
      studyId: "study-1",
      revisionId: fixture.outline.id,
      action: "approve",
    })
    queueGenerationStage(storage, "lesson", fixture.outline.id, "setup-1", "grant-1")
    const createWorker = (clock: () => Date) =>
      new WorkerRuntime({
        storage,
        clock,
        leaseDurationMs: 120_000,
        tokenFactory: randomUUID,
        attemptIdFactory: () => randomUUID(),
        resolveStage: (job) => ({
          kind: "structured",
          runner: new ProviderRunner({
            storage,
            ownerId: "owner-1",
            installationId: "installation-1",
            clock,
            adapters: {
              openrouter: new ProviderAdapter({
                provider: "openrouter",
                apiKey: "fixture",
                baseURL: wire.baseURL,
              }),
            },
          }),
          request: {
            ...generationStage(storage, job),
            onValidated: () => saveGenerationStage(storage, job),
          },
        }),
      })
    const first = await createWorker(() => new Date()).runNext()
    expect(first.kind).toBe("provider")
    if (first.kind !== "provider") return
    expect(first.job).toMatchObject({ state: "paused", reason: "outcome_unknown" })
    storage.close()
    storage = openStorage(paths)
    const restarted = await createWorker(() => new Date(Date.now() + 120_001)).runNext()
    expect(restarted.kind).toBe("idle")
    expect(storage.execution.listAttempts(first.job.runId)).toMatchObject([
      { state: "outcome_unknown", resolution: "awaiting-owner" },
    ])
    expect(wire.requests).toHaveLength(1)
  } finally {
    await wire.close()
    storage.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
