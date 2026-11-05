export const evaluatorProvenance = {
  version: "TEN29-offline-evidence-controls-v1",
  author: "same continuing driver; originals and held-outs already seen",
  independentlyHidden: false,
  newLabelsSeparateFromFrozenAnswers: true,
  purpose: "source/evidence assembly and structural evaluator characterization only",
  semanticScoring: "NOT RUN",
} as const

export const evaluatorControls = [
  {
    id: "faithful-concise-immaterial-omission",
    family: "definitions",
    label: "same-author faithful control, not independently validated",
    candidate:
      "The register distinguishes berth slots from visits, treats missing as unrecorded rather than zero, and does not recommend traffic policy.",
    citationParts: [0, 2],
    qualificationParts: [2, 3],
    mapMode: "full",
    quote: null,
    expectedMissingOriginalParts: [],
    rationale:
      "Bibliographic names and page numbers can be absent from a concise synthesis, but the supplement is still inspected.",
  },
  {
    id: "accurate-quote-false-conclusion",
    family: "reversal",
    label: "same-author seeded negative, not a semantic oracle",
    candidate:
      "The first trial moved ten boats without delay, proving every dawn opening is universally safe.",
    citationParts: [0],
    qualificationParts: [1, 2, 3],
    mapMode: "full",
    quote: "The first trial moved ten boats without delay.",
    expectedMissingOriginalParts: [],
    rationale:
      "R2 explicitly separates speed from safety; R3 withdraws the universal rule; the valid R1 quote cannot establish the conclusion.",
  },
  {
    id: "missing-exception",
    family: "reversal",
    label: "same-author seeded negative, not a semantic oracle",
    candidate: "The council permits opening every gate at dawn on all mornings.",
    citationParts: [0],
    qualificationParts: [1, 2, 3],
    mapMode: "full",
    quote: null,
    expectedMissingOriginalParts: [],
    rationale: "The late water-level condition and dry-only evidence are material exceptions.",
  },
  {
    id: "invented-crosschapter-link",
    family: "chronology",
    label: "same-author seeded negative, not a semantic oracle",
    candidate: "Rain caused the bridge closure and therefore proves that the bell rang before it.",
    citationParts: [0, 3],
    qualificationParts: [1, 2, 3],
    mapMode: "full",
    quote: null,
    expectedMissingOriginalParts: [],
    rationale:
      "N4 says agreement about rain does not resolve bell disagreement; N3 supplies no hour or causal finding.",
  },
  {
    id: "early-only-missed-late-reversal",
    family: "reversal",
    label: "same-author seeded negative with deliberate map qualification omission",
    candidate: "The successful dawn-opening policy remains universal and needs no revision.",
    citationParts: [0],
    qualificationParts: [],
    mapMode: "early-only",
    quote: null,
    expectedMissingOriginalParts: ["late", "supplement"],
    rationale:
      "All originals were supplied to mapping, but the authored map omits late material. Verification must not mistake early citation neighbors for whole-original counterevidence.",
  },
  {
    id: "flattened-disagreement",
    family: "chronology",
    label: "same-author seeded negative, not a semantic oracle",
    candidate: "Mira and Ivo agree that the bell preceded the closure.",
    citationParts: [0, 1, 3],
    qualificationParts: [1, 2, 3],
    mapMode: "full",
    quote: null,
    expectedMissingOriginalParts: [],
    rationale:
      "N1 and N2 disagree; clock/memory limits and N3's uncertainty remain; N4 does not resolve the disagreement.",
  },
] as const
export type EvaluatorControl = (typeof evaluatorControls)[number]
