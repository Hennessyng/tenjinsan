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

it("rejects a later section reusing a completed section's scene ID before completion", async () => {
  const directory = mkdtempSync(join(tmpdir(), "provider-section-scene-"))
  const storage = openStorage({
    databasePath: join(directory, "studio.sqlite"),
    privateDataRoot: join(directory, "private"),
  })
  let wire: Awaited<ReturnType<typeof providerWire>> | undefined
  try {
    const fixture = lessonFixture(storage, "gpt-4.1-mini")
    const firstSection = fixture.outline.content.sections[0]
    if (!firstSection) throw new TypeError("Missing first section")
    const outline = storage.outlines.save({
      studyId: "study-1",
      briefRevisionId: fixture.outline.briefRevisionId,
      expectedRevisionId: fixture.outline.id,
      feedback: null,
      content: {
        ...fixture.outline.content,
        sections: [firstSection, { ...firstSection, id: "section-2" }],
      },
    })
    storage.outlines.decide({ studyId: "study-1", revisionId: outline.id, action: "approve" })
    storage.sources.appendGrant({
      ...completeGraphFixtures().grant,
      categories: ["book-text", "derived-study-material", "reader-context"],
    })
    const firstOutput = { outlineRevisionId: outline.id, sections: fixture.draft.sections }
    const secondOutput = {
      outlineRevisionId: outline.id,
      sections: [{ ...fixture.draft.sections[0], id: "section-2" }],
    }
    wire = await providerWire([
      protocolOutput("openrouter", JSON.stringify(firstOutput)),
      protocolOutput("openrouter", JSON.stringify(secondOutput)),
    ])
    queueGenerationStage(storage, "lesson", outline.id, "setup-1", "grant-1")
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
    const second = await worker.runNext()
    expect(second.kind).toBe("provider")
    if (second.kind !== "provider") return
    expect(second.job).toMatchObject({ state: "failed", error: { code: "malformed-output" } })
    expect(storage.workflow.getLesson(`lesson-${first.job.id}`)).toBeNull()
    expect(wire.requests).toHaveLength(3)
  } finally {
    await wire?.close()
    storage.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
