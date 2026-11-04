import type { z } from "zod"
import type { TechnicalEvidence } from "./constructed-schema.ts"
import { scoreRubric } from "./scoring.ts"
import type { Assessment } from "./workflow-schema.ts"
export function scoreWithEvidence(
  assessment: Assessment,
  technical: z.infer<typeof TechnicalEvidence>,
) {
  const human = assessment.rubric.criticalFlags["unresolved-retained-citation"]
  const citationFlag =
    technical.citationLocationsResolved === false || human === true
      ? true
      : technical.citationLocationsResolved === "unresolved" || human === "unresolved"
        ? "unresolved"
        : false
  return scoreRubric({
    ...assessment.rubric,
    criticalFlags: {
      ...assessment.rubric.criticalFlags,
      "incomplete-included-processing": technical.incompleteIncludedProcessing,
      "unauthorized-authority-change": technical.unauthorizedAuthorityChange,
      "unresolved-retained-citation": citationFlag,
      "missed-seeded-critical-negative": "post-reference",
    },
  })
}
