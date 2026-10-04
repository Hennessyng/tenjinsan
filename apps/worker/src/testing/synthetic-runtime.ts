import { randomUUID } from "node:crypto"
import { setTimeout as delay } from "node:timers/promises"
import { BookMapPipeline } from "@reading-studio/generation"
import type { ProviderReceipt, StructuredRequest } from "@reading-studio/providers"
import { ProviderError, ProviderRunner } from "@reading-studio/providers"
import { renderPublicationOutput } from "@reading-studio/server/publication-service"
import { openStorage, type Storage } from "@reading-studio/storage"
import { z } from "zod"
import { WorkerRuntime } from "../runtime.ts"
import { generateSyntheticLesson } from "./synthetic-lesson.ts"

const SourceWindow = z.array(
  z.strictObject({
    blockId: z.string(),
    resourcePath: z.string(),
    start: z.number().int(),
    end: z.number().int(),
    text: z.string(),
  }),
)

class SyntheticAdapter {
  constructor(readonly fault: "none" | "invalid-output" | "accepted-timeout") {}

  async dispatch(request: StructuredRequest): Promise<ProviderReceipt> {
    const windows = SourceWindow.parse(
      JSON.parse(request.prompt.slice(request.prompt.lastIndexOf("\n") + 1)),
    )
    const window = windows[0]
    if (!window || window.end <= window.start)
      throw new TypeError("Missing synthetic source window")
    if (this.fault === "accepted-timeout") throw new ProviderError("outcome-unknown")
    if (this.fault === "invalid-output") {
      return {
        kind: "output",
        text: '{"claims":[],"concepts":[],"qualifications":[]}',
        usage: { kind: "known", inputTokens: 10, outputTokens: 10 },
      }
    }
    const end = Math.min(window.end, window.start + 12)
    const finding = { start: window.start, end, text: "Listening asks for clarification." }
    return {
      kind: "output",
      text: JSON.stringify({
        claims: [finding],
        concepts: [{ ...finding, text: "Attention" }],
        qualifications: [{ ...finding, text: "Interpretation remains provisional." }],
      }),
      usage: { kind: "known", inputTokens: 10, outputTokens: 10 },
    }
  }
}

function createInterview(storage: Storage, analysisId: string, studyId: string): void {
  if (storage.interviews.latest(studyId)) return
  const analysis = storage.workflow.getAnalysis(analysisId)
  const source = analysis?.claims[0]?.sources[0]
  if (analysis?.status !== "successful" || !source) return
  const common = {
    analysisRevisionId: analysis.id,
    policy: { custom: true, unsure: true, skip: true },
    minSelections: 1,
  }
  storage.interviews.create({
    id: randomUUID(),
    studyId,
    analysisRevisionId: analysis.id,
    contextRevisionId: randomUUID(),
    groups: [
      { id: "attention", label: { en: "Attention and listening", ja: "注意と傾聴" } },
      { id: "practice", label: { en: "Practice", ja: "実践" } },
    ],
    shortlist: ["angle", "context", "decision"],
    steps: [
      {
        groupId: "attention",
        purpose: "preference",
        question: {
          ...common,
          id: "angle",
          revisionId: randomUUID(),
          mode: "single",
          maxSelections: 1,
          prompt: { en: "Where would you like to begin?", ja: "どこから始めたいですか？" },
          lens: { label: { en: "Attention", ja: "注意" }, sources: [source] },
          options: [
            { id: "listen", label: { en: "Listen before interpreting", ja: "解釈する前に聴く" } },
            { id: "ask", label: { en: "Ask a more open question", ja: "開かれた問いを立てる" } },
          ],
        },
      },
      {
        groupId: "practice",
        purpose: "preference",
        question: {
          ...common,
          id: "context",
          revisionId: randomUUID(),
          mode: "multi",
          maxSelections: 2,
          prompt: { en: "Where could this matter to you?", ja: "どこで役立ちますか？" },
          options: [
            { id: "work", label: { en: "At work", ja: "職場で" } },
            { id: "home", label: { en: "At home", ja: "家庭で" } },
          ],
        },
      },
      {
        groupId: "practice",
        purpose: "approval",
        question: {
          ...common,
          id: "decision",
          revisionId: randomUUID(),
          mode: "single",
          maxSelections: 1,
          policy: { custom: false, unsure: false, skip: false },
          prompt: { en: "How should these responses be used?", ja: "回答をどう扱いますか？" },
          options: [
            { id: "approve", label: { en: "Approve these responses", ja: "回答を承認する" } },
            { id: "defer", label: { en: "Defer this decision", ja: "判断を保留する" } },
          ],
        },
      },
    ],
  })
}

export async function runSyntheticWorker(signal: AbortSignal): Promise<void> {
  const config = z
    .object({
      DATABASE_PATH: z.string().min(1),
      PRIVATE_DATA_ROOT: z.string().min(1),
    })
    .parse(process.env)
  const storage = openStorage({
    databasePath: config.DATABASE_PATH,
    privateDataRoot: config.PRIVATE_DATA_ROOT,
    runtimeRole: "worker",
  })
  const fault = z
    .enum(["none", "invalid-output", "accepted-timeout"])
    .default("none")
    .parse(process.env["STUDIO_SYNTHETIC_TEST_FAULT"])
  const adapter = new SyntheticAdapter(fault)
  const studies = new Set<string>()
  const editions = new Map<string, string>()
  const worker = new WorkerRuntime({
    storage,
    clock: () => new Date(),
    leaseDurationMs: 120_000,
    tokenFactory: randomUUID,
    attemptIdFactory: () => randomUUID(),
    resolveStage: (job) => {
      const authority = {
        storage,
        ownerId: job.grant.ownerId,
        installationId: job.grant.installationId,
      }
      const pipeline = new BookMapPipeline(authority)
      const runner = new ProviderRunner({
        ...authority,
        clock: () => new Date(),
        adapters: { openai: adapter, anthropic: adapter },
      })
      return { kind: "structured", runner, request: pipeline.stage(job) }
    },
  })
  try {
    while (!signal.aborted) {
      const result = await worker.runNext()
      const postJobAdmission = storage.maintenance.enter()
      if (postJobAdmission !== null)
        try {
          if (result.kind === "provider" && result.job.state === "completed") {
            const job = result.job
            const authority = {
              storage,
              ownerId: job.grant.ownerId,
              installationId: job.grant.installationId,
            }
            const map = new BookMapPipeline(authority).prepare(job.setupRevisionId, job.grant.id)
            const setup = storage.sources.getSetup(job.setupRevisionId)
            if (setup && map.status === "successful") {
              createInterview(storage, map.id, setup.studyId)
              studies.add(setup.studyId)
              editions.set(map.editionId, job.grant.ownerId)
            }
          }
          for (const [editionId, ownerId] of editions) {
            for (const study of storage.sources.listStudiesByEdition(editionId)) {
              if (study.ownerId === ownerId && storage.interviews.latest(study.id))
                studies.add(study.id)
            }
          }
          for (const studyId of studies) generateSyntheticLesson(storage, studyId)
          for (const studyId of studies) {
            for (const snapshot of storage.publicationOutputs.list(studyId)) {
              if (!storage.publicationOutputs.current(snapshot)) continue
              for (const output of storage.publicationOutputs.outputs(snapshot.publication.id)) {
                if (output.state === "queued") await renderPublicationOutput(storage, output)
              }
            }
          }
        } finally {
          storage.maintenance.leave(postJobAdmission)
        }
      if (result.kind === "idle") {
        try {
          await delay(100, undefined, { signal })
        } catch (error: unknown) {
          if (!signal.aborted) throw error
        }
      }
    }
  } finally {
    storage.close()
  }
}
