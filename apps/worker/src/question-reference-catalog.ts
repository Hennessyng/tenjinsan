import {
  AnalysisRevision,
  analysisCacheKey,
  contentDigest,
  InputRevisionId,
  NormalizationRevision,
  NormalizedStudySetup,
  type SourceSpan,
  StudySetupRevision,
} from "@reading-studio/contracts"
import { reviewedSourceBlocks } from "@reading-studio/providers"
import { z } from "zod"

export const QUESTION_REFERENCE_VERSION = "question-evidence-refs-v1" as const
const Input = z
  .strictObject({
    setup: StudySetupRevision,
    analysis: AnalysisRevision,
    normalization: NormalizationRevision,
    contextRevisionId: InputRevisionId,
  })
  .readonly()
export class QuestionReferenceError extends Error {
  override readonly name = "QuestionReferenceError"
  constructor(readonly code: "binding" | "evidence" | "reference") {
    super(`Question reference contract: ${code}`)
  }
}
export function questionReferenceCatalog(raw: unknown) {
  const parsed = Input.safeParse(raw)
  if (!parsed.success) throw new QuestionReferenceError("binding")
  const input = parsed.data
  const { setup, analysis, normalization, contextRevisionId } = input
  if (
    analysis.status !== "successful" ||
    analysis.editionId !== setup.editionId ||
    analysis.cacheKey !== analysisCacheKey(setup.analysis) ||
    analysis.cacheKey !== analysisCacheKey(analysis.cacheInput) ||
    !NormalizedStudySetup.safeParse({ setup, normalization }).success
  )
    throw new QuestionReferenceError("binding")
  const approved = reviewedSourceBlocks(setup, normalization)
  const findings = [
    ...analysis.claims.map((item) => ({ ...item, category: "claim" as const })),
    ...analysis.concepts.map((item) => ({ ...item, category: "concept" as const })),
    ...analysis.qualifications.map((item) => ({ ...item, category: "qualification" as const })),
  ]
  const spans = new Map<string, SourceSpan>()
  for (const finding of findings)
    for (const span of finding.sources) {
      const block = approved.find(
        (item) =>
          item.editionId === span.editionId &&
          item.normalizationRevisionId === span.normalizationRevisionId &&
          item.resourcePath === span.resourcePath &&
          item.blockId === span.blockId,
      )
      if (
        !block ||
        span.start < block.start ||
        span.end > block.end ||
        block.text.slice(span.start, span.end) !== span.originalFragment ||
        span.pageLabel !== block.pageLabel
      )
        throw new QuestionReferenceError("evidence")
      spans.set(JSON.stringify(span), span)
    }
  if (!spans.size) throw new QuestionReferenceError("evidence")
  const binding = contentDigest(
    JSON.stringify([QUESTION_REFERENCE_VERSION, setup, analysis, normalization, contextRevisionId]),
  )
  const citations = Object.freeze(
    [...spans.values()].map((span) =>
      Object.freeze({ id: `evidence-${contentDigest(JSON.stringify([binding, span]))}`, span }),
    ),
  )
  const reference = (span: SourceSpan): string => {
    const found = citations.find((item) => JSON.stringify(item.span) === JSON.stringify(span))
    if (!found) throw new QuestionReferenceError("reference")
    return found.id
  }
  const resolve = (id: string): SourceSpan => {
    const found = citations.find((item) => item.id === id)
    if (!found) throw new QuestionReferenceError("reference")
    return found.span
  }
  return Object.freeze({
    input,
    binding,
    citations,
    reference,
    resolve,
    findings: Object.freeze(
      findings.map((finding) =>
        Object.freeze({
          category: finding.category,
          text: finding.text,
          evidenceRefs: Object.freeze(finding.sources.map(reference)),
        }),
      ),
    ),
  })
}
