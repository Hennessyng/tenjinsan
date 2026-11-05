import { analysisCacheKey, contentDigest, type Job } from "@reading-studio/contracts"
import type { StructuredStage } from "@reading-studio/providers"
import { ProviderError, selectedEvidence } from "@reading-studio/providers"
import type { Storage } from "@reading-studio/storage"
import { QUESTION_REFERENCE_VERSION, QuestionReferenceError } from "./question-reference-catalog.ts"
import { questionReferenceContract } from "./question-reference-contract.ts"

export function questionStageContract(storage: Storage, job: Job) {
  const setup = storage.sources.getSetup(job.setupRevisionId)
  if (
    !setup ||
    job.stage !== "questions" ||
    job.provider !== setup.analysis.provider ||
    job.model !== setup.analysis.model ||
    job.inputRevisionId !== `analysis-${contentDigest(setup.id)}`
  )
    throw new ProviderError("unauthorized")
  const analysis = storage.workflow.findSuccessfulAnalysis(analysisCacheKey(setup.analysis), {
    setupId: setup.id,
    grantId: job.grant.id,
  })
  const normalization = storage.sources.getNormalization(setup.analysis.normalizationRevisionId)
  if (!analysis || !normalization)
    throw new TypeError("Successful analysis and normalization required")
  let contract: ReturnType<typeof questionReferenceContract>
  try {
    contract = questionReferenceContract({
      setup,
      analysis,
      normalization,
      contextRevisionId: job.inputRevisionId,
    })
  } catch (error) {
    if (!(error instanceof QuestionReferenceError)) throw error
    throw new ProviderError("bank-incompatible")
  }
  const evidence = selectedEvidence(
    storage,
    contract.catalog.citations.map((item) => item.span),
  )
  const first = contract.catalog.citations[0]?.span
  if (!first) throw new ProviderError("bank-incompatible")
  const request: StructuredStage = {
    schema: contract.schema,
    sourceWindow: { blockId: first.blockId, start: first.start, end: first.end },
    instruction: JSON.stringify({
      task: QUESTION_REFERENCE_VERSION,
      binding: contract.catalog.binding,
      instructions:
        "Create distinct book-grounded bilingual choice lenses. Include a complication and multiple selectable options for every lens. Ground every lens, rationale and complication in the supplied findings, preserving their qualifications; do not introduce evidence from uncited ranges. Cite only supplied evidenceRefs. Do not author quote spans or revision labels; application resolves exact evidence and identities.",
      citations: contract.catalog.citations,
      passages: evidence.passages,
      findings: contract.catalog.findings,
    }),
  }
  return { ...contract, request }
}
