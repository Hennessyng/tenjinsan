import { chronologyNarrative } from "./chronology.ts"
import type { CandidateBody, FamilyNarrative, StatementScript } from "./control-types.ts"
import { definitionsNarrative } from "./definitions.ts"
import { mixedNarrative } from "./mixed.ts"
import { reversalNarrative } from "./reversal.ts"
export const familyNarratives: readonly FamilyNarrative[] = [
  reversalNarrative,
  definitionsNarrative,
  chronologyNarrative,
  mixedNarrative,
]
export const candidateBodies: readonly CandidateBody[] = familyNarratives.flatMap(
  (family, familyIndex) => {
    const make = (variant: number, statement: StatementScript, full: boolean): CandidateBody => ({
      privateId: `c${String(familyIndex * 8 + variant + 1).padStart(3, "0")}`,
      family: family.family,
      thesis: [statement],
      progression: full
        ? family.parts.map((part, index) => ({ text: part.text, parts: [index] }))
        : [statement],
      connections: [],
      conflicts: [],
      changesOfPosition: [],
      uncertainties: [],
    })
    return [
      make(0, { text: family.full, parts: [0, 1, 2, 3] }, true),
      make(1, { text: family.concise, parts: [0, 1, 2, 3] }, false),
      ...family.negatives.map((negative, index) =>
        make(index + 2, { text: negative.text, parts: negative.parts }, false),
      ),
    ]
  },
)
