import { types } from "node:util"
import {
  analysisCacheKey,
  type SetupAnalysisProgress,
  type SetupSchedulingFailure,
  type StudySetupRevision,
  setupProgressUrl,
  TransmissionGrant,
} from "@reading-studio/contracts"
import { BookMapPipeline } from "@reading-studio/generation"
import {
  QuestionsHandoffError,
  questionBankStatus,
  queueQuestions,
} from "@reading-studio/generation/queue-questions"
import { ImmutableRecordError, type SourceRepository, type Storage } from "@reading-studio/storage"
import { z } from "zod"

const SchedulingDomainFailure = z.discriminatedUnion("name", [
  z.object({
    name: z.literal("ProviderError"),
    code: z.enum([
      "missing-credentials",
      "unsupported-model",
      "unsupported-settings",
      "outcome-unknown",
      "unauthorized",
      "input-limit",
      "subscription-unverified",
      "subscription-connection-changed",
    ]),
  }),
  z.object({
    name: z.literal("QuestionsHandoffError"),
    code: z.enum(["bank-incompatible", "unauthorized"]),
  }),
])

export function setupAnalysisProgress(
  storage: Storage | undefined,
  setup: StudySetupRevision,
  grantId: string,
): SetupAnalysisProgress {
  if (!storage) return "unknown"
  const analysis = storage.workflow.findSuccessfulAnalysis(analysisCacheKey(setup.analysis))
  const bankStatus = questionBankStatus(storage, setup, analysis)
  switch (bankStatus) {
    case "compatible":
      return "questions-ready"
    case "incompatible":
      return "bank-incompatible"
    case "missing":
      break
    default:
      return assertNever(bankStatus)
  }
  const jobs = storage.execution
    .listSetupJobs(setup.id)
    .filter(
      (job) => (job.stage === "analysis" || job.stage === "questions") && job.grant.id === grantId,
    )
  const questions = jobs.filter((job) => job.stage === "questions")
  if (questions.some((job) => job.state === "paused" && job.reason === "outcome_unknown"))
    return "questions-unknown"
  if (questions.some((job) => job.state === "queued" || job.state === "running"))
    return "questions-queued"
  if (questions.length > 0) return "questions-attention"
  if (analysis) return "analysis-ready"
  if (jobs.some((job) => job.state === "queued" || job.state === "running")) return "queued"
  return jobs.length > 0 ? "attention" : "not-scheduled"
}

function assertNever(value: never): never {
  throw new TypeError(`Unknown question bank status: ${value}`)
}

export function savedSetupDecision(
  storage: Storage | undefined,
  setup: StudySetupRevision,
  grantId: string,
) {
  const analysisProgress = setupAnalysisProgress(storage, setup, grantId)
  const schedulingFailure = storage?.setupScheduling.failure(grantId) ?? null
  return {
    decision: "send" as const,
    grantId,
    analysisProgress,
    progressUrl: setupProgressUrl(setup.id),
    schedulingFailure,
    canResume:
      (analysisProgress === "not-scheduled" || analysisProgress === "analysis-ready") &&
      (schedulingFailure === null || schedulingFailure === "scheduling-interrupted"),
    ...(analysisProgress === "questions-ready"
      ? { questionsUrl: `/interviews/${encodeURIComponent(setup.studyId)}` }
      : {}),
  }
}

export type SetupSendInput = {
  readonly setupId: string
  readonly grantId: string
  readonly ownerId: string
  readonly installationId: string
}

export function acceptSetupGrant(sources: SourceRepository, input: unknown) {
  const grant = TransmissionGrant.parse(input)
  const retained = () => {
    const existing = sources.getGrant(grant.id)
    if (
      !existing ||
      existing.kind !== grant.kind ||
      existing.setupRevisionId !== grant.setupRevisionId ||
      existing.ownerId !== grant.ownerId ||
      existing.installationId !== grant.installationId
    )
      return null
    return { grant: existing, created: false }
  }
  if (sources.getGrant(grant.id)) return retained()
  try {
    return { grant: sources.appendGrant(grant), created: true }
  } catch (error) {
    if (!(error instanceof ImmutableRecordError)) throw error
    return retained()
  }
}

export function scheduleApprovedSetup(
  onSend: ((input: SetupSendInput) => void) | undefined,
  input: SetupSendInput,
): SetupSchedulingFailure | null {
  try {
    onSend?.(input)
    return null
  } catch (error) {
    if (!types.isNativeError(error)) throw error
    const domain = SchedulingDomainFailure.safeParse(error)
    const failure =
      domain.success && error.constructor.name === domain.data.name
        ? domain.data.code
        : "scheduling-interrupted"
    console.warn(
      JSON.stringify({
        event: "setup-scheduling-incomplete",
        setupId: input.setupId,
        code: failure,
      }),
    )
    return failure
  }
}

export function studySetupSend(storage: Storage, queueFollowup = true, localSubscriptions = false) {
  return (input: {
    readonly setupId: string
    readonly grantId: string
    readonly ownerId: string
    readonly installationId: string
  }) => {
    const setup = storage.sources.getSetup(input.setupId)
    if (
      setup &&
      questionBankStatus(
        storage,
        setup,
        storage.workflow.findSuccessfulAnalysis(analysisCacheKey(setup.analysis)),
      ) === "incompatible"
    )
      throw new QuestionsHandoffError("bank-incompatible")
    const analysis = new BookMapPipeline({
      storage,
      ownerId: input.ownerId,
      installationId: input.installationId,
      localSubscriptions,
    }).prepare(input.setupId, input.grantId)
    if (queueFollowup) queueQuestions(storage, input.setupId, input.grantId, analysis)
  }
}
