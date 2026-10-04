import { randomUUID } from "node:crypto"
import { rmSync } from "node:fs"
import { ProviderAdapter, ProviderRunner } from "@reading-studio/providers"
import { afterEach, expect, it } from "vitest"
import { questionsStage, queueQuestions, saveQuestions } from "../src/production-questions.ts"
import { WorkerRuntime } from "../src/runtime.ts"
import { bookMapFixture, FixtureAdapter, fixtureWorker } from "./book-map-fixture.ts"
import { protocolOutput, providerWire } from "./providers-wire.ts"

const fixtures: ReturnType<typeof bookMapFixture>[] = []
afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    fixture.storage.close()
    rmSync(fixture.directory, { recursive: true, force: true })
  }
})

it("persists selectable book-cited model questions from the real SDK wire after analysis", async () => {
  const fixture = bookMapFixture(undefined, 1, true)
  fixtures.push(fixture)
  const mapping = fixtureWorker(fixture.storage, new FixtureAdapter())
  mapping.pipeline.prepare("setup-1", "grant-1")
  while ((await mapping.worker.runNext()).kind !== "idle") {}
  const analysis = mapping.pipeline.prepare("setup-1", "grant-1")
  const source = analysis.claims[0]?.sources[0]
  if (!source) throw new TypeError("Missing mapped source")
  const revisionId = fixture.storage.workflow.ensureAnalysisInput("setup-1")
  const draft = {
    analysisRevisionId: analysis.id,
    contextRevisionId: revisionId,
    groups: [{ id: "focus", label: { en: "Focus", ja: "焦点" } }],
    lenses: [
      {
        id: "lens-1",
        revisionId: "question-1",
        groupId: "focus",
        learningGoalKey: "practice-attention",
        label: { en: "Attention", ja: "注意" },
        rationale: { en: "Explore attention", ja: "注意を考える" },
        sources: [source],
        complications: [{ label: { en: "Limit", ja: "限界" }, sources: [source] }],
        prompt: { en: "Which attention skill?", ja: "どの注意力？" },
        mode: "single",
        minSelections: 1,
        maxSelections: 1,
        options: [
          {
            id: "listen",
            goalKey: "listen",
            label: { en: "Listen", ja: "聴く" },
            rationale: { en: "Notice", ja: "気づく" },
          },
          {
            id: "notice",
            goalKey: "notice",
            label: { en: "Notice", ja: "見る" },
            rationale: { en: "Observe", ja: "観察" },
          },
        ],
      },
    ],
  }
  const wire = await providerWire([protocolOutput("openrouter", JSON.stringify(draft))])
  try {
    queueQuestions(fixture.storage, "setup-1", "grant-1", analysis)
    const authority = {
      storage: fixture.storage,
      ownerId: "owner-1",
      installationId: "installation-1",
    }
    const runner = new ProviderRunner({
      ...authority,
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
      storage: fixture.storage,
      clock: () => new Date(),
      leaseDurationMs: 120_000,
      tokenFactory: randomUUID,
      attemptIdFactory: () => randomUUID(),
      resolveStage: (job) => ({
        kind: "structured",
        runner,
        request: {
          ...questionsStage(fixture.storage, job),
          onValidated: () => saveQuestions(fixture.storage, job),
        },
      }),
    })
    const result = await worker.runNext()
    expect(result.kind).toBe("provider")
    if (result.kind !== "provider") return
    expect(result.job.state).toBe("completed")
    expect(fixture.storage.interviews.latest("study-1")?.steps[0]?.question.options).toHaveLength(2)
    expect(wire.requests).toHaveLength(1)
  } finally {
    await wire.close()
  }
})
