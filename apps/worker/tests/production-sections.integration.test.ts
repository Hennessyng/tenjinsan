import { randomUUID } from "node:crypto"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { OutlineContent } from "@reading-studio/contracts"
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
import { z } from "zod"
import { WorkerRuntime } from "../src/runtime.ts"
import { lessonFixture } from "./lesson-fixture.ts"
import { protocolOutput, providerWire } from "./providers-wire.ts"

it("refuses an outline with thirteen sections before section jobs can be queued", () => {
  const directory = mkdtempSync(join(tmpdir(), "provider-section-count-"))
  const storage = openStorage({
    databasePath: join(directory, "studio.sqlite"),
    privateDataRoot: join(directory, "private"),
  })
  try {
    const fixture = lessonFixture(storage, "gpt-4.1-mini")
    const sections = Array.from({ length: 13 }, (_, index) => ({
      ...fixture.outline.content.sections[0],
      id: `section-${index + 1}`,
    }))
    expect(() => OutlineContent.parse({ ...fixture.outline.content, sections })).toThrow()
    expect(storage.execution.listCompletedLessonJobs()).toEqual([])
  } finally {
    storage.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

it("checkpoints three ordered sections and publishes only after all bounded calls", async () => {
  const directory = mkdtempSync(join(tmpdir(), "provider-sections-"))
  const storage = openStorage({
    databasePath: join(directory, "studio.sqlite"),
    privateDataRoot: join(directory, "private"),
  })
  let wire: Awaited<ReturnType<typeof providerWire>> | undefined
  try {
    const fixture = lessonFixture(storage, "gpt-4.1-mini")
    const sections = Array.from({ length: 3 }, (_, index) => ({
      ...fixture.outline.content.sections[0],
      id: `section-${index + 1}`,
    }))
    const draft = storage.outlines.save({
      studyId: "study-1",
      briefRevisionId: fixture.outline.briefRevisionId,
      expectedRevisionId: fixture.outline.id,
      feedback: null,
      content: { ...fixture.outline.content, sections },
    })
    storage.outlines.decide({ studyId: "study-1", revisionId: draft.id, action: "approve" })
    storage.sources.appendGrant({
      ...completeGraphFixtures().grant,
      categories: ["book-text", "derived-study-material", "reader-context"],
    })
    const outputs = sections.map((section) => ({
      outlineRevisionId: draft.id,
      sections: [
        {
          ...fixture.draft.sections[0],
          id: section.id,
          title: section.title,
          scenes: fixture.draft.sections[0]?.scenes.map((scene) => ({
            ...scene,
            id: `scene-${section.id}`,
          })),
          sceneNotes: fixture.draft.sections[0]?.sceneNotes.map((note) => ({
            ...note,
            id: `scene-${section.id}`,
          })),
        },
      ],
    }))
    wire = await providerWire(
      outputs.map((output) => protocolOutput("openai", JSON.stringify(output))),
    )
    queueGenerationStage(storage, "lesson", draft.id, "setup-1", "grant-1")
    const runner = new ProviderRunner({
      storage,
      ownerId: "owner-1",
      installationId: "installation-1",
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
    let firstJobId = ""
    for (const index of sections.keys()) {
      const result = await worker.runNext()
      expect(result.kind).toBe("provider")
      if (result.kind !== "provider") return
      expect(result.job.state).toBe("completed")
      if (index === 0) firstJobId = result.job.id
      expect(result.job.checkpoint).not.toBeNull()
      expect(wire.requests).toHaveLength(index + 1)
      expect(
        wire.requests.every((request) => Buffer.byteLength(JSON.stringify(request)) <= 32_000),
      ).toBe(true)
      if (index < sections.length - 1)
        expect(storage.workflow.getLesson(`lesson-${firstJobId}`)).toBeNull()
      advanceLessonStage(storage, result.job)
    }
    expect(storage.workflow.getLesson(`lesson-${firstJobId}`)?.sections).toHaveLength(3)
    expect(wire.requests).toHaveLength(3)
    const order = wire.requests.map((request) => {
      const messages = z
        .object({ messages: z.array(z.object({ content: z.string() })) })
        .parse(request)
      const match = /Outline: (\{.*\}) Evidence:/s.exec(messages.messages.at(-1)?.content ?? "")
      return z
        .object({ sections: z.array(z.object({ id: z.string() })) })
        .parse(JSON.parse(match?.[1] ?? "")).sections[0]?.id
    })
    expect(order).toEqual(sections.map((section) => section.id))
  } finally {
    await wire?.close()
    storage.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

it("replays a received section receipt after a crashed worker without redelivery", async () => {
  const directory = mkdtempSync(join(tmpdir(), "provider-section-replay-"))
  const paths = {
    databasePath: join(directory, "studio.sqlite"),
    privateDataRoot: join(directory, "private"),
  }
  let storage = openStorage(paths)
  let wire: Awaited<ReturnType<typeof providerWire>> | undefined
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
    const connected = await providerWire([protocolOutput("openai", JSON.stringify(fixture.draft))])
    wire = connected
    queueGenerationStage(storage, "lesson", fixture.outline.id, "setup-1", "grant-1")
    const createWorker = (crash: boolean, clock: () => Date) =>
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
              openai: new ProviderAdapter({
                provider: "openai",
                apiKey: "fixture",
                baseURL: connected.baseURL,
              }),
            },
          }),
          request: {
            ...generationStage(storage, job),
            onValidated: () => {
              if (crash) throw new TypeError("Simulated crash after receipt")
              saveGenerationStage(storage, job)
            },
          },
        }),
      })
    await expect(createWorker(true, () => new Date()).runNext()).rejects.toThrow("Simulated crash")
    expect(wire.requests).toHaveLength(1)
    storage.close()
    storage = openStorage(paths)
    const result = await createWorker(false, () => new Date(Date.now() + 120_001)).runNext()
    expect(result.kind).toBe("provider")
    if (result.kind !== "provider") return
    expect(result.job.state).toBe("completed")
    advanceLessonStage(storage, result.job)
    expect(storage.workflow.getLesson(`lesson-${result.job.id}`)?.sections).toHaveLength(1)
    expect(storage.execution.listAttempts(result.job.runId)).toHaveLength(1)
    expect(wire.requests).toHaveLength(1)
  } finally {
    await wire?.close()
    storage.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
