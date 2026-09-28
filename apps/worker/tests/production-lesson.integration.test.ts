import { randomUUID } from "node:crypto"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
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

for (const consent of [true, false]) {
  it(`uses approved outline and ${consent ? "explicit derived/context grant" : "refuses book-only grant"} for bilingual lesson wire`, async () => {
    const directory = mkdtempSync(join(tmpdir(), "provider-lesson-"))
    const storage = openStorage({
      databasePath: join(directory, "studio.sqlite"),
      privateDataRoot: join(directory, "private"),
    })
    const fixture = lessonFixture(storage, "gpt-4.1-mini")
    const wire = await providerWire([protocolOutput("openai", JSON.stringify(fixture.draft))])
    try {
      const grant = completeGraphFixtures().grant
      storage.sources.appendGrant(
        consent
          ? {
              ...grant,
              categories: ["book-text", "derived-study-material", "reader-context"],
            }
          : grant,
      )
      storage.outlines.decide({
        studyId: "study-1",
        revisionId: fixture.outline.id,
        action: "approve",
      })
      queueGenerationStage(storage, "lesson", fixture.outline.id, "setup-1", "grant-1")
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
      if (consent) {
        expect(
          result.job.state,
          JSON.stringify(result.job.state === "failed" ? result.job.error : null),
        ).toBe("completed")
        expect(wire.requests).toHaveLength(1)
        advanceLessonStage(storage, result.job)
        expect(storage.workflow.getLesson(`lesson-${result.job.id}`)?.sections).toHaveLength(1)
      } else {
        expect(wire.requests).toHaveLength(0)
        expect(result.job.state).toBe("failed")
      }
    } finally {
      await wire.close()
      storage.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
}
