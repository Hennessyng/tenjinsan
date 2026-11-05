import { z } from "zod"

export const ANALYSIS_EVALUATION_PURPOSE = {
  version: "analysis-evaluation-1",
  terminal: "verified-analysis",
} as const
export const AnalysisEvaluationPurpose = z
  .strictObject({
    version: z.literal(ANALYSIS_EVALUATION_PURPOSE.version),
    terminal: z.literal(ANALYSIS_EVALUATION_PURPOSE.terminal),
  })
  .readonly()
export type AnalysisEvaluationPurpose = z.infer<typeof AnalysisEvaluationPurpose>
