import { randomUUID } from "node:crypto"
import { queueQuestions } from "@reading-studio/generation/queue-questions"
import {
  localRequestBytes,
  type ProviderReceipt,
  ProviderRunner,
  type StructuredRequest,
} from "@reading-studio/providers"
import { z } from "zod"
import { questionsStage, saveQuestions } from "../src/production-questions.ts"
import { WorkerRuntime } from "../src/runtime.ts"
import { questionHandoffFixture } from "./question-handoff-fixture.ts"

export const Repair = z.object({
  format: z.literal("json-only"),
  issues: z.array(
    z.object({
      code: z.string(),
      path: z.array(z.union([z.string(), z.number()])),
      rule: z.string().optional(),
    }),
  ),
})
export function requestRepair(request: StructuredRequest) {
  const metadata = z.object({ schemaRepair: Repair }).safeParse(request)
  let value: unknown
  try {
    value = JSON.parse(request.prompt.split("\n")[0] ?? "")
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
  }
  const wire = z.object({ schemaRepair: Repair }).safeParse(value)
  return metadata.success &&
    wire.success &&
    JSON.stringify(metadata.data.schemaRepair) === JSON.stringify(wire.data.schemaRepair)
    ? metadata.data.schemaRepair
    : null
}

export async function questionRepairFixture() {
  const fixture = await questionHandoffFixture(true)
  const { storage, setup, grant, pipeline } = fixture
  const analysis = pipeline.prepare(setup.id, grant.id)
  queueQuestions(storage, setup.id, grant.id, analysis)
  const job = storage.execution.listSetupJobs(setup.id)[0]
  const source = analysis.claims[0]?.sources[0]
  if (!job || !source) throw new TypeError("Synthetic repair precondition missing")
  const contextRevisionId = job.inputRevisionId
  const paired = (en: string) => ({ en, ja: `合成 ${en}` })
  function draft(duplicate: boolean) {
    return {
      analysisRevisionId: analysis.id,
      contextRevisionId,
      groups: [{ id: "focus", label: paired("Focus") }],
      lenses: [0, 1].map((index) => ({
        id: `lens-${index}`,
        revisionId: duplicate ? "revision-shared" : `revision-${index}`,
        groupId: "focus",
        learningGoalKey: `goal-${index}`,
        label: paired(`Lens ${index}`),
        rationale: paired("NATIVE_RESPONSE_DIAGNOSTIC_SENTINEL"),
        sources: [source],
        complications: [{ label: paired(`Complication ${index}`), sources: [source] }],
        prompt: paired(`Question ${index}`),
        mode: "single",
        minSelections: 1,
        maxSelections: 1,
        options: [0, 1, 2].map((option) => ({
          id: `option-${index}-${option}`,
          goalKey: `option-goal-${option}`,
          label: paired(`Option ${option}`),
          rationale: paired(`Reason ${option}`),
        })),
      })),
    }
  }
  function worker(
    dispatch: (request: StructuredRequest) => Promise<ProviderReceipt>,
    options: {
      readonly clock?: () => Date
      readonly measure?: (request: StructuredRequest) => Promise<number>
    } = {},
  ) {
    const clock = options.clock ?? (() => new Date())
    return new WorkerRuntime({
      storage,
      clock,
      leaseDurationMs: 120000,
      tokenFactory: randomUUID,
      attemptIdFactory: () => randomUUID(),
      resolveStage: (current) => ({
        kind: "structured",
        runner: new ProviderRunner({
          storage,
          ownerId: grant.ownerId,
          installationId: grant.installationId,
          localSubscriptions: true,
          clock,
          adapters: {
            "chatgpt-subscription": {
              measure:
                options.measure ??
                (async (request) => localRequestBytes("chatgpt-subscription", request)),
              dispatch,
            },
          },
        }),
        request: {
          ...questionsStage(storage, current),
          onValidated: () => saveQuestions(storage, current),
        },
      }),
    })
  }
  return { ...fixture, job, bad: draft(true), good: draft(false), worker }
}
