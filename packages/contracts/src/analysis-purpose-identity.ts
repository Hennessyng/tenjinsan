import type { AnalysisEvaluationPurpose } from "./analysis-purpose.ts"
import { contentDigest } from "./identity.ts"
export function analysisInputIdentity(setupId: string, purpose?: AnalysisEvaluationPurpose) {
  return `analysis-${contentDigest(purpose ? JSON.stringify([setupId, purpose]) : setupId)}`
}
export function foundationJobIdentity(
  setupId: string,
  grantId: string,
  key: string,
  kind: string,
  index = 0,
) {
  return `wb-${contentDigest(JSON.stringify([setupId, grantId, key, kind, index]))}`
}
