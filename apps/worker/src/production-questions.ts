import { analysisCacheKey, type Job, type Question } from "@reading-studio/contracts"
import { interpretationVerified } from "@reading-studio/generation"
import { generateQuestions } from "@reading-studio/generation/questions"
import {
  QuestionsHandoffError,
  questionBankStatus,
} from "@reading-studio/generation/queue-questions"

export { queueQuestions } from "@reading-studio/generation/queue-questions"

import { ProviderError, ProviderReceipt, type StructuredStage } from "@reading-studio/providers"
import { ImmutableRecordError, type Storage } from "@reading-studio/storage"
import { persistedQuestionIdentity } from "./persisted-question-identity.ts"
import { questionStageContract } from "./question-stage-contract.ts"

export function questionsStage(storage: Storage, job: Job): StructuredStage {
  return questionStageContract(storage, job).request
}

export function saveQuestions(storage: Storage, job: Job): void {
  const setup = storage.sources.getSetup(job.setupRevisionId)
  const analysis =
    setup &&
    storage.workflow.findSuccessfulAnalysis(analysisCacheKey(setup.analysis), {
      setupId: setup.id,
      grantId: job.grant.id,
    })
  if (!setup || !analysis) throw new TypeError("Current questions analysis missing")
  if (
    storage.sources.getLatestSetup(setup.studyId)?.id !== setup.id ||
    storage.sources.getGrant(job.grant.id)?.kind !== "active"
  )
    throw new ProviderError("unauthorized")
  if (
    job.inputRevisionId !== storage.workflow.ensureAnalysisInput(setup.id) ||
    job.stage !== "questions" ||
    job.provider !== setup.analysis.provider ||
    job.model !== setup.analysis.model ||
    job.grant.setupRevisionId !== setup.id
  )
    throw new QuestionsHandoffError("unauthorized")
  const bankStatus = questionBankStatus(storage, setup, analysis)
  switch (bankStatus) {
    case "compatible":
      return
    case "incompatible":
      throw new ProviderError("bank-incompatible")
    case "missing":
      break
    default:
      assertNever(bankStatus)
  }
  const attempt = storage.execution.listAttempts(job.runId).at(-1)
  const body = attempt && storage.execution.getAttemptReceipt(attempt.id)
  if (!body) throw new TypeError("Missing durable questions receipt")
  const receipt = ProviderReceipt.parse(JSON.parse(new TextDecoder().decode(body)))
  if (receipt.kind !== "output") throw new TypeError("Questions output unavailable")
  const output = questionStageContract(storage, job).parseText(receipt.text)
  if (
    setup.analysis.analysisPromptVersion === "whole-book-2" &&
    !interpretationVerified(storage, job)
  )
    return
  const context = {
    revisionId: job.inputRevisionId,
    studyId: setup.studyId,
    preferredGoalKeys: [],
    customQuestion: null,
  }
  const bank = generateQuestions(
    {
      analysis,
      context,
      expected: {
        analysisRevisionId: analysis.id,
        contextRevisionId: job.inputRevisionId,
        studyId: setup.studyId,
      },
    },
    output,
  )
  const lensIds = new Map<string, string>()
  const materialized = bank.lenses.map((lens, index) => {
    const identity = persistedQuestionIdentity({
      setup,
      analysisRevisionId: analysis.id,
      contextRevisionId: job.inputRevisionId,
      position: index,
    })
    const question: Question = { ...lens.question, ...identity }
    const existing = storage.workflow.getQuestion(question.revisionId)
    if (existing && JSON.stringify(existing) !== JSON.stringify(question))
      throw new ProviderError("question-revision-conflict")
    lensIds.set(lens.id, identity.id)
    return { ...lens, ...identity, question }
  })
  for (const lens of materialized) {
    const existing = storage.workflow.getQuestion(lens.question.revisionId)
    if (!existing) {
      try {
        storage.workflow.appendQuestion({ record: lens.question, parentRevisionId: null })
      } catch (error) {
        if (
          !(error instanceof ImmutableRecordError) ||
          error.entity !== "question revision" ||
          error.id !== lens.question.revisionId
        )
          throw error
        const retained = storage.workflow.getQuestion(lens.question.revisionId)
        if (!retained) throw error
        if (JSON.stringify(retained) !== JSON.stringify(lens.question))
          throw new ProviderError("question-revision-conflict")
      }
    }
  }
  const shortlist = bank.shortlist.map((id) => {
    const persisted = lensIds.get(id)
    if (!persisted) throw new TypeError("Generated shortlist does not reference a current question")
    return persisted
  })
  storage.interviews.create({
    id: `interview-${job.id}`,
    studyId: setup.studyId,
    analysisRevisionId: analysis.id,
    contextRevisionId: job.inputRevisionId,
    groups: bank.groups,
    steps: materialized.map((lens) => ({
      groupId: lens.groupId,
      purpose: "preference",
      question: lens.question,
    })),
    shortlist,
  })
}

function assertNever(value: never): never {
  throw new TypeError(`Unknown question bank status: ${value}`)
}
