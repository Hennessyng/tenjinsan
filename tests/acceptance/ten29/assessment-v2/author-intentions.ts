import { candidateBodies, familyNarratives } from "./controls.ts"
export function authorIntentions() {
  return familyNarratives.flatMap((family) => {
    const candidates = candidateBodies.filter((row) => row.family === family.family)
    return candidates.map((candidate, index) => {
      const negative = index >= 2 ? family.negatives[index - 2] : undefined
      if (index >= 2 && !negative) throw new TypeError("Missing authored negative intention")
      return {
        privateId: candidate.privateId,
        family: family.family,
        split:
          family.family === "reversal" || family.family === "definitions"
            ? "tuning"
            : "held-out-from-tuning-author-already-exposed",
        intendedLabel: index < 2 ? "faithful" : "negative",
        negativeKind: negative?.kind ?? null,
        conciseOmissionProposal: index === 1 ? family.omittedImmaterialDetail : null,
        quote: negative?.quote ?? null,
        proposedCritical: index >= 2,
        criticalBasis: negative
          ? family.family === "reversal"
            ? "Material error/omission involving the seeded late correction; human must corroborate criticality and flag applicability"
            : "Material seeded evaluator negative; human must corroborate materiality and criticality"
          : null,
        humanCorroboration: "UNCONFIRMED",
        humanReferenceLabel: null,
        authorship: "Test-fixture author intention only; not an independent semantic label",
      }
    })
  })
}
