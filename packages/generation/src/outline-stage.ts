import { type Job, OutlineContent } from "@reading-studio/contracts"
import {
  ProviderError,
  type StructuredRequest,
  type StructuredStage,
  selectedEvidence,
} from "@reading-studio/providers"
import type { Storage } from "@reading-studio/storage"

type RepairRule = NonNullable<
  NonNullable<StructuredRequest["schemaRepair"]>["issues"][number]["rule"]
>

export function outlineStage(
  storage: Storage,
  job: Job,
  sourceWindow: NonNullable<StructuredStage["sourceWindow"]>,
): StructuredStage {
  const brief = storage.briefs.approved(job.inputRevisionId)
  if (!brief || brief.setupRevisionId !== job.setupRevisionId)
    throw new TypeError("Current approved brief required")
  const requestId = job.id.slice("outline-".length)
  const request = storage.outlines.request(requestId)
  const currentOutline = storage.outlines.current(brief.studyId)
  if (
    request &&
    (request.briefRevisionId !== brief.id ||
      (currentOutline?.draft.id !== request.id &&
        !storage.outlines.follows(currentOutline?.draft.id ?? "", request.id)))
  )
    throw new ProviderError("unauthorized")
  const analysis = storage.workflow.getAnalysis(brief.analysisRevisionId)
  if (analysis?.status !== "successful") throw new TypeError("Successful analysis required")
  const findings = [...analysis.claims, ...analysis.concepts, ...analysis.qualifications]
  const known = new Set(
    findings.flatMap((finding) => finding.sources.map((span) => JSON.stringify(span))),
  )
  const selected = selectedEvidence(
    storage,
    findings.flatMap((finding) => finding.sources),
  )
  const evidence = findings.map((finding) => ({
    id: finding.id,
    text: finding.text,
    sources: finding.sources.map(selected.reference),
  }))
  const approvedQuestions = [brief.guidingQuestion, ...brief.supportingQuestions].map(
    (question, questionIndex) => ({ questionIndex, question }),
  )
  const outlineContract = {
    retained: { qualifications: analysis.qualifications, excludedAreas: brief.exclusions },
    approvedQuestions,
  }
  return {
    sourceWindow,
    schema: OutlineContent.superRefine((draft, context) => {
      const constraint = (path: (string | number)[], rule: RepairRule) =>
        context.addIssue({
          code: "custom",
          path,
          message: "outline output differs from approved constraints",
          params: { rule },
        })
      if (JSON.stringify(draft.qualifications) !== JSON.stringify(analysis.qualifications)) {
        let located = false
        if (draft.qualifications.length === analysis.qualifications.length) {
          for (const [index, expected] of analysis.qualifications.entries()) {
            const actual = draft.qualifications[index]
            if (!actual) continue
            for (const field of ["id", "text", "sources"] as const) {
              if (JSON.stringify(actual[field]) !== JSON.stringify(expected[field])) {
                constraint(["qualifications", index, field], "retain-outline-qualifications")
                located = true
              }
            }
          }
        }
        if (!located) constraint(["qualifications"], "retain-outline-qualifications")
      }
      if (JSON.stringify(draft.excludedAreas) !== JSON.stringify(brief.exclusions))
        constraint(["excludedAreas"], "retain-outline-exclusions")
      for (const [index, section] of draft.sections.entries()) {
        if (section.questionIndex >= approvedQuestions.length)
          constraint(["sections", index, "questionIndex"], "approved-outline-question-index")
        if (
          [...section.sources, ...section.visualEvidence].some(
            (span) => !known.has(JSON.stringify(span)),
          )
        )
          context.addIssue({
            code: "custom",
            message: "outline citation outside approved evidence",
          })
      }
    }),
    instruction: `${JSON.stringify({ outlineContract })}\nWrite a bilingual teaching outline from this approved reader brief and retrieved book evidence. Return only the outline schema, not the input contract. Copy outlineContract.retained exactly, including qualification IDs, text, citations and order. questionIndex indexes only outlineContract.approvedQuestions, never interview answers; multiple sections may share an approved index. Copy exact citations from the citation table. No unsupported visual claims. ${request ? `Revision: ${JSON.stringify({ previous: request.content, feedback: request.feedback })}. ` : ""}Citations: ${JSON.stringify(selected.citations)} Passages: ${JSON.stringify(selected.passages)} Brief: ${JSON.stringify(brief)} Evidence: ${JSON.stringify(evidence)}`,
  }
}
