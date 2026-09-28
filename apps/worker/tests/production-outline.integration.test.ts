import { randomUUID } from "node:crypto"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fixtureOutlineProvider } from "@reading-studio/generation/outline"
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
import { protocolOutput, providerWire } from "./providers-wire.ts"

it("queues an approved-brief outline and saves model output before marking its job complete", async () => {
  const directory = mkdtempSync(join(tmpdir(), "provider-outline-"))
  const storage = openStorage({
    databasePath: join(directory, "studio.sqlite"),
    privateDataRoot: join(directory, "private"),
  })
  let wire: Awaited<ReturnType<typeof providerWire>> | undefined
  try {
    lessonFixture(storage, "gpt-4.1-mini")
    const setup = storage.sources.getSetup("setup-1")
    const interview = storage.interviews.latest("study-1")
    const currentBrief = storage.briefs.current("study-1")
    if (!setup || !interview || !currentBrief) throw new TypeError("Incomplete persisted fixture")
    storage.sources.createStudy({ id: "study-2", ownerId: "owner-1", editionId: setup.editionId })
    storage.sources.appendSetup({
      record: { ...setup, id: "setup-2", studyId: "study-2" },
      parentRevisionId: null,
    })
    storage.sources.appendGrant({
      ...completeGraphFixtures().grant,
      id: "grant-2",
      setupRevisionId: "setup-2",
      categories: ["book-text", "derived-study-material", "reader-context"],
    })
    storage.interviews.create({
      ...interview,
      id: "interview-2",
      studyId: "study-2",
      contextRevisionId: "context-2",
    })
    const draft = storage.briefs.save({
      studyId: "study-2",
      expectedRevisionId: null,
      content: currentBrief.draft.content,
    })
    storage.briefs.decide({ studyId: "study-2", revisionId: draft.id, action: "approve" })
    const brief = storage.briefs.approved(draft.id)
    const analysis = brief && storage.workflow.getAnalysis(brief.analysisRevisionId)
    if (!brief || !analysis) throw new TypeError("Approved analysis missing")
    const output = fixtureOutlineProvider({ brief, analysis, previous: null, feedback: null })
    wire = await providerWire([protocolOutput("openai", JSON.stringify(output))])
    queueGenerationStage(storage, "outline", brief.id, "setup-2", "grant-2")
    const authority = { storage, ownerId: "owner-1", installationId: "installation-1" }
    const runner = new ProviderRunner({
      ...authority,
      clock: () => new Date(),
      adapters: {
        openai: new ProviderAdapter({
          provider: "openai",
          apiKey: "fixture",
          baseURL: wire.baseURL,
        }),
      },
    })
    const worker = new WorkerRuntime({
      storage,
      clock: () => new Date(),
      leaseDurationMs: 120_000,
      tokenFactory: randomUUID,
      attemptIdFactory: () => randomUUID(),
      resolveStage: (job) => ({
        kind: "structured",
        runner,
        request: {
          ...generationStage(storage, job),
          onValidated: () => saveGenerationStage(storage, job),
        },
      }),
    })
    const result = await worker.runNext()
    expect(result.kind).toBe("provider")
    if (result.kind !== "provider") return
    expect(
      result.job.state,
      JSON.stringify(result.job.state === "failed" ? result.job.error : null),
    ).toBe("completed")
    expect(storage.outlines.current("study-2")?.draft.content.sections).toHaveLength(1)
    expect(wire.requests).toHaveLength(1)
  } finally {
    await wire?.close()
    storage.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
