export const negativeKinds = [
  "quote-false-conclusion",
  "omitted-exception",
  "invented-relationship",
  "early-only",
  "flattened-disagreement",
  "unsupported-overstated",
] as const
export type NegativeKind = (typeof negativeKinds)[number]
export type FamilyId = "reversal" | "definitions" | "chronology" | "mixed"
export type StatementScript = { readonly text: string; readonly parts: readonly number[] }
export type CandidateBody = {
  readonly privateId: string
  readonly family: FamilyId
  readonly thesis: readonly StatementScript[]
  readonly progression: readonly StatementScript[]
  readonly connections: readonly StatementScript[]
  readonly conflicts: readonly StatementScript[]
  readonly changesOfPosition: readonly StatementScript[]
  readonly uncertainties: readonly StatementScript[]
}
export type FamilyNarrative = {
  readonly family: FamilyId
  readonly parts: readonly {
    readonly text: string
    readonly role: "claims" | "definitions" | "examples" | "qualifications" | "uncertainties"
  }[]
  readonly full: string
  readonly concise: string
  readonly omittedImmaterialDetail: string
  readonly negatives: readonly {
    readonly kind: NegativeKind
    readonly text: string
    readonly parts: readonly number[]
    readonly quote?: string
  }[]
  readonly inapplicable: readonly { readonly kind: NegativeKind; readonly reason: string }[]
}
