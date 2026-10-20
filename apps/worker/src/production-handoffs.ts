import { analysisCacheKey, type TransmissionGrant } from "@reading-studio/contracts"
import { BookMapPipeline } from "@reading-studio/generation"
import {
  QuestionsHandoffError,
  questionBankStatus,
  queueQuestions,
} from "@reading-studio/generation/queue-questions"
import { ProviderError } from "@reading-studio/providers"
import type { Storage } from "@reading-studio/storage"
import { saveQuestions } from "./production-questions.ts"

export function recoverQuestionHandoffs(storage: Storage, localSubscriptions: boolean): void {
  for (const grant of storage.sources.listActiveGrants()) {
    const setup = storage.sources.getSetup(grant.setupRevisionId)
    if (
      !setup ||
      setup.analysis.provider === "openai" ||
      storage.sources.getLatestSetup(setup.studyId)?.id !== setup.id
    )
      continue
    advanceQuestionHandoff(storage, grant, localSubscriptions)
  }
}

export function advanceQuestionHandoff(
  storage: Storage,
  grant: TransmissionGrant,
  localSubscriptions: boolean,
): void {
  const setup = storage.sources.getSetup(grant.setupRevisionId)
  try {
    if (!setup || storage.sources.getLatestSetup(setup.studyId)?.id !== setup.id)
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
      localSubscriptions,
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
