import {
  type AnalysisRevision,
  analysisCacheKey,
  contentDigest,
  Job,
  RunBudget,
  type StudySetupRevision,
} from "@reading-studio/contracts"
import type { Storage } from "@reading-studio/storage"

export class QuestionsHandoffError extends Error {
  override readonly name = "QuestionsHandoffError"
  constructor(readonly code: "bank-incompatible" | "unauthorized") {
    super(code)
  }
}

export function questionBankStatus(
  storage: Storage,
  setup: StudySetupRevision,
  analysis: AnalysisRevision | null,
): "missing" | "compatible" | "incompatible" {
  const bank = storage.interviews.latest(setup.studyId)
  if (!bank) return "missing"
  return bank.studyId === setup.studyId &&
    bank.analysisRevisionId === analysis?.id &&
    bank.contextRevisionId === `analysis-${contentDigest(setup.id)}`
    ? "compatible"
    : "incompatible"
}

export function queueQuestions(
  storage: Storage,
  setupId: string,
  grantId: string,
  analysis: AnalysisRevision,
): void {
  if (analysis.status !== "successful") return
  const setup = storage.sources.getSetup(setupId)
  const grant = storage.sources.getGrant(grantId)
  if (
    !setup ||
    grant?.kind !== "active" ||
    grant.setupRevisionId !== setup.id ||
    storage.sources.getLatestSetup(setup.studyId)?.id !== setup.id ||
    analysis.cacheKey !== analysisCacheKey(setup.analysis) ||
    storage.workflow.findSuccessfulAnalysis(analysis.cacheKey)?.id !== analysis.id
  )
    throw new QuestionsHandoffError("unauthorized")
  const bankStatus = questionBankStatus(storage, setup, analysis)
  switch (bankStatus) {
    case "compatible":
      return
    case "incompatible":
      throw new QuestionsHandoffError("bank-incompatible")
    case "missing":
      break
    default:
      assertNever(bankStatus)
  }
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

function assertNever(value: never): never {
  throw new TypeError(`Unknown question bank status: ${value}`)
}
