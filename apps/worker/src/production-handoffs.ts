import { analysisCacheKey, type Job, type TransmissionGrant } from "@reading-studio/contracts"
import { BookMapPipeline } from "@reading-studio/generation"
import { advanceLessonStage, saveGenerationStage } from "@reading-studio/generation/provider-stages"
import {
  QuestionsHandoffError,
  questionBankStatus,
  queueQuestions,
} from "@reading-studio/generation/queue-questions"
import {
  type ProviderAuthority,
  ProviderError,
  type VerifiedRouteCapacity,
} from "@reading-studio/providers"
import type { Storage } from "@reading-studio/storage"
import { saveQuestions } from "./production-questions.ts"

export function recoverQuestionHandoffs(
  storage: Storage,
  localSubscriptions: boolean,
  capacity?: VerifiedRouteCapacity,
): void {
  for (const grant of storage.sources.listActiveGrants()) {
    const setup = storage.sources.getSetup(grant.setupRevisionId)
    if (
      !setup ||
      setup.analysis.purpose ||
      !storage.liveStudyGuard.includes(setup.id) ||
      setup.analysis.provider === "openai" ||
      storage.sources.getLatestSetup(setup.studyId)?.id !== setup.id
    )
      continue
    advanceQuestionHandoff(storage, grant, {
      localSubscriptions,
      ...(capacity ? { capacity } : {}),
    })
    resumeGenerationChecks(storage, setup.id)
  }
}

export function advanceQuestionHandoff(
  storage: Storage,
  grant: TransmissionGrant,
  access: boolean | Pick<ProviderAuthority, "localSubscriptions" | "capacity">,
): void {
  const providerAccess = typeof access === "boolean" ? { localSubscriptions: access } : access
  const setup = storage.sources.getSetup(grant.setupRevisionId)
  try {
    if (
      !setup ||
      setup.analysis.purpose ||
      storage.sources.getLatestSetup(setup.studyId)?.id !== setup.id
    )
      throw new ProviderError("unauthorized")
    const refusal = storage.setupScheduling.failure(grant.id)
    if (refusal && refusal !== "scheduling-interrupted") {
      console.info(
        JSON.stringify({ event: "question-handoff-blocked", setupId: setup.id, code: refusal }),
      )
      return
    }
    if (
      questionBankStatus(
        storage,
        setup,
        storage.workflow.findSuccessfulAnalysis(analysisCacheKey(setup.analysis)),
      ) === "incompatible"
    )
      throw new QuestionsHandoffError("bank-incompatible")
    const analysis = new BookMapPipeline({
      storage,
      ...providerAccess,
      ownerId: grant.ownerId,
      installationId: grant.installationId,
    }).prepare(setup.id, grant.id)
    for (const job of storage.execution.listSetupJobs(setup.id)) {
      if (job.grant.id === grant.id && job.stage === "questions" && job.state === "completed")
        saveQuestions(storage, job)
    }
    queueQuestions(storage, setup.id, grant.id, analysis)
  } catch (error) {
    if (!(error instanceof ProviderError || error instanceof QuestionsHandoffError)) throw error
    console.info(
      JSON.stringify({
        event: "question-handoff-blocked",
        setupId: grant.setupRevisionId,
        code: error.code,
      }),
    )
  }
}
export function resumeGenerationChecks(storage: Storage, setupId: string): void {
  const setup = storage.sources.getSetup(setupId)
  if (
    setup?.analysis.purpose ||
    setup?.analysis.analysisPromptVersion !== "whole-book-2" ||
    storage.sources.getLatestSetup(setup.studyId)?.id !== setup.id
  )
    return
  for (const job of storage.execution.listSetupJobs(setupId)) {
    if (
      job.state !== "completed" ||
      job.cancellationRequested ||
      storage.sources.getGrant(job.grant.id)?.kind !== "active"
    )
      continue
    if (job.stage === "outline" && storage.briefs.approved(job.inputRevisionId))
      saveGenerationStage(storage, job)
    if (job.stage === "lesson") {
      const outline = storage.outlines.current(setup.studyId)
      const approved = storage.outlines.approved(job.inputRevisionId)
      if (outline?.status === "approved" && approved && outline.draft.id === approved.id)
        advanceLessonStage(storage, job)
    }
  }
}
export function advanceProductionStage(
  storage: Storage,
  job: Job,
  access: Pick<ProviderAuthority, "localSubscriptions" | "capacity">,
): void {
  if (job.state !== "completed" || storage.sources.getSetup(job.setupRevisionId)?.analysis.purpose)
    return
  if (job.stage === "analysis") {
    advanceQuestionHandoff(storage, job.grant, access)
    if (job.id.startsWith("check-")) resumeGenerationChecks(storage, job.setupRevisionId)
  }
  if (job.stage === "lesson") advanceLessonStage(storage, job)
}
