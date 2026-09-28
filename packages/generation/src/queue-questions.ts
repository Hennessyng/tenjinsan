import { type AnalysisRevision, contentDigest, Job, RunBudget } from "@reading-studio/contracts"
import type { Storage } from "@reading-studio/storage"

export function queueQuestions(
  storage: Storage,
  setupId: string,
  grantId: string,
  analysis: AnalysisRevision,
): void {
  if (analysis.status !== "successful") return
  const setup = storage.sources.getSetup(setupId)
  const grant = storage.sources.getGrant(grantId)
  if (!setup || !grant || storage.interviews.latest(setup.studyId)) return
  const inputRevisionId = storage.workflow.ensureAnalysisInput(setupId)
  const id = `questions-${contentDigest(JSON.stringify([setupId, grantId, analysis.id]))}`
  if (!storage.execution.getRun(id))
    storage.execution.appendRun({
      id,
      inputRevisionId,
      budget: RunBudget.parse({ maxCalls: 2 }),
      reservedCalls: 0,
      state: "running",
    })
  if (!storage.execution.getJob(id))
    storage.execution.appendJob(
      Job.parse({
        id,
        runId: id,
        inputRevisionId,
        setupRevisionId: setupId,
        provider: setup.analysis.provider,
        model: setup.analysis.model,
        promptVersion: setup.generation.promptVersion,
        schemaVersion: setup.generation.schemaVersion,
        grant,
        stage: "questions",
        checkpoint: null,
        cancellationRequested: false,
        usage: { kind: "known", inputTokens: 0, outputTokens: 0 },
        state: "queued",
      }),
    )
}
