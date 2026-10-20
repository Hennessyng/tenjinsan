import { randomUUID } from "node:crypto"
import { BookMapPipeline } from "@reading-studio/generation"
import { ProviderAdapter, ProviderRunner } from "@reading-studio/providers"
import type { Storage } from "@reading-studio/storage"
import { questionsStage, queueQuestions, saveQuestions } from "../src/production-questions.ts"
import { WorkerRuntime } from "../src/runtime.ts"
import { protocolOutput, providerWire, type WireReply } from "./providers-wire.ts"

export async function interviewWorker(storage: Storage, setupId: string) {
  const setup = storage.sources.getSetup(setupId)
  const grant = storage.sources.getGrant(`grant-${setupId}`)
  if (!setup || !grant) throw new TypeError("Explicit Send must precede fixture execution")
  const authority = { storage, ownerId: grant.ownerId, installationId: grant.installationId }
  const replies: WireReply[] = [
    protocolOutput(
      "anthropic",
      JSON.stringify({
        claims: [{ text: "Ask careful questions.", start: 0, end: 9 }],
        concepts: [],
        qualifications: [],
      }),
    ),
  ]
  const wire = await providerWire(replies)
  const pipeline = new BookMapPipeline(authority)
  const runner = new ProviderRunner({
    ...authority,
    clock: () => new Date(),
    adapters: {
      anthropic: new ProviderAdapter({
        provider: "anthropic",
        apiKey: "fixture-not-a-credential",
        baseURL: wire.baseURL,
      }),
    },
  })
  const worker = new WorkerRuntime({
    storage,
    clock: () => new Date(),
    leaseDurationMs: 120000,
    tokenFactory: randomUUID,
    attemptIdFactory: () => randomUUID(),
    resolveStage: (job) => {
      switch (job.stage) {
        case "analysis":
          return { kind: "structured", runner, request: pipeline.stage(job) }
        case "questions":
          return {
            kind: "structured",
            runner,
            request: {
              ...questionsStage(storage, job),
              onValidated: () => saveQuestions(storage, job),
            },
          }
        default:
          throw new TypeError("Unexpected fixture stage")
      }
    },
  })
  return {
    wire,
    runAnalysis: () => worker.runNext(),
    queueQuestions: () => {
      const analysis = pipeline.prepare(setup.id, grant.id)
      const source = analysis.claims[0]?.sources[0]
      if (analysis.status !== "successful" || !source)
        throw new TypeError("Fixture analysis failed")
      const inputRevisionId = storage.workflow.ensureAnalysisInput(setup.id)
      const draft = {
        analysisRevisionId: analysis.id,
        contextRevisionId: inputRevisionId,
        groups: [{ id: "focus", label: { en: "Focus", ja: "焦点" } }],
        lenses: ["attention", "practice"].map((id, index) => ({
          id,
          revisionId: `question-${id}`,
          groupId: "focus",
          learningGoalKey: id,
          label: { en: id, ja: index === 0 ? "注意" : "実践" },
          rationale: { en: "Explore the source", ja: "資料を考える" },
          sources: [source],
          complications: [{ label: { en: "Limit", ja: "限界" }, sources: [source] }],
          prompt: {
            en: index === 0 ? "Which skill matters?" : "Where will you practice?",
            ja: index === 0 ? "どの力が大切ですか？" : "どこで実践しますか？",
          },
          mode: "single",
          minSelections: 1,
          maxSelections: 1,
          options: [
            {
              id: `${id}-listen`,
              goalKey: `${id}-listen`,
              label: { en: "Listen", ja: "聴く" },
              rationale: { en: "Notice", ja: "気づく" },
            },
            {
              id: `${id}-ask`,
              goalKey: `${id}-ask`,
              label: { en: "Ask", ja: "尋ねる" },
              rationale: { en: "Reflect", ja: "振り返る" },
            },
          ],
        })),
      }
      queueQuestions(storage, setup.id, grant.id, analysis)
      const questionJob = storage.execution
        .listSetupJobs(setup.id)
        .find((job) => job.stage === "questions")
      if (!questionJob) throw new TypeError("Missing queued questions")
      questionsStage(storage, questionJob).schema.parse(draft)
      replies.push(protocolOutput("anthropic", JSON.stringify(draft)))
    },
    runQuestions: () => worker.runNext(),
  }
}
