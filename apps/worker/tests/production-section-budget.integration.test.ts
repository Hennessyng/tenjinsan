import { randomUUID } from "node:crypto"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Job, RunBudget } from "@reading-studio/contracts"
import {
  advanceLessonStage,
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

it("shares the setup's 64 reservations across earlier stages and section jobs", async () => {
  const directory = mkdtempSync(join(tmpdir(), "provider-section-budget-"))
  const storage = openStorage({
    databasePath: join(directory, "studio.sqlite"),
    privateDataRoot: join(directory, "private"),
  })
  let wire: Awaited<ReturnType<typeof providerWire>> | undefined
  try {
    const fixture = lessonFixture(storage, "gpt-4.1-mini")
    const second = { ...fixture.outline.content.sections[0], id: "section-2" }
    const outline = storage.outlines.save({
      studyId: "study-1",
      briefRevisionId: fixture.outline.briefRevisionId,
      expectedRevisionId: fixture.outline.id,
      feedback: null,
      content: {
        ...fixture.outline.content,
        sections: [fixture.outline.content.sections[0], second],
      },
    })
    storage.outlines.decide({ studyId: "study-1", revisionId: outline.id, action: "approve" })
    const grant = storage.sources.appendGrant({
      ...completeGraphFixtures().grant,
      categories: ["book-text", "derived-study-material", "reader-context"],
    })
    const setup = storage.sources.getSetup("setup-1")
    if (!setup) throw new TypeError("Missing setup")
    for (let index = 0; index < 63; index++) {
      const id = `prior-${index}`
      storage.execution.appendRun({
        id,
        inputRevisionId: outline.id,
        budget: RunBudget.parse({ maxCalls: 1 }),
        reservedCalls: 0,
        state: "running",
      })
      storage.execution.appendJob(
        Job.parse({
          id,
          runId: id,
          inputRevisionId: outline.id,
          setupRevisionId: setup.id,
          provider: setup.analysis.provider,
          model: setup.analysis.model,
          promptVersion: setup.analysis.analysisPromptVersion,
          schemaVersion: setup.analysis.analysisSchemaVersion,
          grant,
          stage: "analysis",
          checkpoint: null,
          cancellationRequested: false,
          usage: { kind: "known", inputTokens: 0, outputTokens: 0 },
          state: "queued",
        }),
      )
      const now = new Date()
      const claimed = storage.execution.claimNextJob({
        token: randomUUID(),
        now: now.toISOString(),
        expiresAt: new Date(now.getTime() + 120_000).toISOString(),
      })
      if (claimed?.state !== "running") throw new TypeError("Prior job was not claimed")
      const lease = {
        jobId: claimed.id,
        token: claimed.lease.token,
        fence: claimed.lease.fence,
        now: now.toISOString(),
      }
      expect(
        storage.execution.reserveAttempt({
          ...lease,
          attemptId: randomUUID(),
          preparedAt: now.toISOString(),
        }).kind,
      ).toBe("prepared")
      storage.execution.completeJob({ ...lease, resultHash: "a".repeat(64) })
    }
    wire = await providerWire([
      protocolOutput(
        "openrouter",
        JSON.stringify({
          outlineRevisionId: outline.id,
          sections: fixture.draft.sections,
        }),
      ),
    ])
    queueGenerationStage(storage, "lesson", outline.id, setup.id, grant.id)
    const runner = new ProviderRunner({
      storage,
      ownerId: "owner-1",
      installationId: "installation-1",
      clock: () => new Date(),
      adapters: {
        openrouter: new ProviderAdapter({
          provider: "openrouter",
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
    const first = await worker.runNext()
    expect(first.kind).toBe("provider")
    if (first.kind !== "provider") return
    expect(first.job.state).toBe("completed")
    advanceLessonStage(storage, first.job)
    const secondResult = await worker.runNext()
    expect(secondResult.kind).toBe("provider")
    if (secondResult.kind !== "provider") return
    expect(secondResult.job).toMatchObject({ state: "paused", reason: "budget-exhausted" })
    expect(storage.execution.listAttempts(secondResult.job.runId)).toHaveLength(0)
    expect(wire.requests).toHaveLength(1)
    expect(storage.workflow.getLesson(`lesson-${first.job.id}`)).toBeNull()
  } finally {
    await wire?.close()
    storage.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
