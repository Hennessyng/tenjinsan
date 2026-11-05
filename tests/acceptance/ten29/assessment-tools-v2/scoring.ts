import { RubricInput } from "./rubric-schema.ts"
export function scoreRubric(input: unknown) {
  const value = RubricInput.parse(input)
  const total = Object.values(value.dimensionScores).reduce((sum, score) => sum + score, 0)
  const critical =
    Object.values(value.criticalFlags).some((flag) => flag === true) ||
    value.chapters.some(
      (row) => row.decision === "misrepresented" || row.decision === "materially-omitted",
    )
  const unresolved =
    Object.values(value.criticalFlags).some((flag) => flag === "unresolved") ||
    value.enJaApplicability === "unresolved" ||
    value.chapters.some((row) => row.decision === "unresolved")
  return {
    total,
    thresholdPassed:
      total >= 12 && Object.values(value.dimensionScores).every((score) => score >= 1),
    critical,
    unresolved,
    accepted:
      total >= 12 &&
      Object.values(value.dimensionScores).every((score) => score >= 1) &&
      !critical &&
      !unresolved,
  }
}
export function rate(numerator: number, denominator: number): number | null {
  if (
    !Number.isSafeInteger(numerator) ||
    !Number.isSafeInteger(denominator) ||
    numerator < 0 ||
    denominator < 0 ||
    numerator > denominator
  )
    throw new TypeError("Invalid arithmetic denominator/numerator")
  return denominator === 0 ? null : numerator / denominator
}
