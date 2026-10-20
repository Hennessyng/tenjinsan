import { analysisCacheKey, type Job } from "@reading-studio/contracts"
import {
  DiscoveryDraft,
  DiscoveryError,
  generateQuestions,
} from "@reading-studio/generation/questions"
import {
  QuestionsHandoffError,
  questionBankStatus,
} from "@reading-studio/generation/queue-questions"
import { z } from "zod"

export { queueQuestions } from "@reading-studio/generation/queue-questions"

import {
  ProviderError,
  ProviderReceipt,
  type StructuredStage,
  selectedEvidence,
} from "@reading-studio/providers"
import type { Storage } from "@reading-studio/storage"

export function questionsStage(storage: Storage, job: Job): StructuredStage {
  const setup = storage.sources.getSetup(job.setupRevisionId)
  if (
    !setup ||
    job.stage !== "questions" ||
    job.provider !== setup.analysis.provider ||
    job.model !== setup.analysis.model
  )
    throw new TypeError("Foreign questions job")
  const analysis = storage.workflow.findSuccessfulAnalysis(analysisCacheKey(setup.analysis))
  if (!analysis) throw new TypeError("Successful analysis required")
  const findings = [...analysis.claims, ...analysis.concepts, ...analysis.qualifications]
  const known = new Set(
    findings.flatMap((finding) => finding.sources.map((span) => JSON.stringify(span))),
  )
  const selectedEvidenceSet = selectedEvidence(
    storage,
    findings.flatMap((finding) => finding.sources),
  )
  const evidence = findings.map((finding) => ({
    text: finding.text,
    sources: finding.sources.map((span) => ({
      reference: selectedEvidenceSet.reference(span),
    })),
  }))
  const selected = setup.analysis.scope.selected[0]
  const block = selected?.blockIds[0]
  const normalization = storage.sources.getNormalization(setup.analysis.normalizationRevisionId)
  const text = normalization?.resources.find((item) => item.path === selected?.resourcePath)
  const source =
    text?.status === "included" ? text.blocks.find((item) => item.id === block) : undefined
  if (!source) throw new TypeError("Approved source window required")
  return {
    schema: DiscoveryDraft.superRefine((draft, context) => {
      try {
        generateQuestions(
          {
            analysis,
            context: {
              revisionId: job.inputRevisionId,
              studyId: setup.studyId,
              preferredGoalKeys: [],
              customQuestion: null,
            },
            expected: {
              analysisRevisionId: analysis.id,
              contextRevisionId: job.inputRevisionId,
              studyId: setup.studyId,
            },
          },
          draft,
        )
      } catch (error) {
        if (!(error instanceof DiscoveryError || error instanceof z.ZodError)) throw error
        context.addIssue({ code: "custom", message: "unusable question choices" })
      }
      if (
        draft.analysisRevisionId !== analysis.id ||
        draft.contextRevisionId !== job.inputRevisionId
      )
        context.addIssue({ code: "custom", message: "wrong question lineage" })
      for (const lens of draft.lenses)
        if (
          [...lens.sources, ...lens.complications.flatMap((entry) => entry.sources)].some(
            (span) => !known.has(JSON.stringify(span)),
          )
        )
          context.addIssue({
            code: "custom",
            message: "question evidence is not in the approved analysis",
          })
    }),
    sourceWindow: { blockId: source.id, start: 0, end: Math.min(source.text.length, 12_000) },
    instruction: `Create distinct book-grounded bilingual choice lenses; use only cited evidence and copy exact citations from the citation table into the output schema. Include a complication and multiple selectable options for every lens. Exact analysisRevisionId=${analysis.id}, contextRevisionId=${job.inputRevisionId}. Citations: ${JSON.stringify(selectedEvidenceSet.citations)} Passages: ${JSON.stringify(selectedEvidenceSet.passages)} Evidence: ${JSON.stringify(evidence)}`,
  }
}

export function saveQuestions(storage: Storage, job: Job): void {
  const setup = storage.sources.getSetup(job.setupRevisionId)
  const analysis =
    setup && storage.workflow.findSuccessfulAnalysis(analysisCacheKey(setup.analysis))
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
      throw new QuestionsHandoffError("bank-incompatible")
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
  const output = questionsStage(storage, job).schema.parse(JSON.parse(receipt.text))
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
  for (const lens of bank.lenses) {
    const existing = storage.workflow.getQuestion(lens.question.revisionId)
    if (existing && JSON.stringify(existing) !== JSON.stringify(lens.question))
      throw new TypeError("Question revision collision")
    if (!existing)
      storage.workflow.appendQuestion({ record: lens.question, parentRevisionId: null })
  }
  storage.interviews.create({
    id: `interview-${job.id}`,
    studyId: setup.studyId,
    analysisRevisionId: analysis.id,
    contextRevisionId: job.inputRevisionId,
    groups: bank.groups,
    steps: bank.lenses.map((lens) => ({
      groupId: lens.groupId,
      purpose: "preference",
      question: lens.question,
    })),
    shortlist: bank.shortlist,
  })
}

function assertNever(value: never): never {
  throw new TypeError(`Unknown question bank status: ${value}`)
}
