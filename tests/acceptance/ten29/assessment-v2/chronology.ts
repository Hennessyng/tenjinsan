import type { FamilyNarrative } from "./control-types.ts"
export const chronologyNarrative: FamilyNarrative = {
  family: "chronology",
  parts: [
    {
      role: "claims",
      text: "Writing on Friday from memory, Mira places Tuesday's bell after the bridge closure.",
    },
    {
      role: "uncertainties",
      text: "Ivo's Tuesday log places the bell before closure, but his stopped clock prevents treating the written sequence as a reliable timestamp.",
    },
    {
      role: "uncertainties",
      text: "A maintenance slip confirms Tuesday's closure without an hour; the narrator cannot settle the order of bell and closure.",
    },
    {
      role: "qualifications",
      text: "Both accounts place the start of rain on Monday, but that agreement does not resolve their different bell/closure sequences.",
    },
  ],
  full: "Mira's retrospective Friday account and Ivo's Tuesday log give opposing orders for bell and bridge closure. Memory and a stopped clock limit their evidence; the dated maintenance slip fixes Tuesday but no hour. Agreement that rain began Monday does not resolve the bell dispute or establish a causal explanation.",
  concise:
    "A memory account and a log with a stopped clock disagree about the bell's order relative to Tuesday's closure. A date-only slip and shared Monday-rain recollection leave that order unresolved.",
  omittedImmaterialDetail:
    "Friday as the writing day and the witnesses' names; memory/log limitations and unresolved Tuesday order remain. Human corroboration required.",
  negatives: [
    {
      kind: "quote-false-conclusion",
      quote: "His clock had stopped",
      parts: [1],
      text: "“His clock had stopped” fixes Ivo's account to a stable time reference. His log therefore conclusively establishes that the bell preceded the closure.",
    },
    {
      kind: "omitted-exception",
      parts: [1, 2],
      text: "Ivo's log establishes the bell-before-closure sequence, and the maintenance slip corroborates it by confirming Tuesday's closure. Together the documents settle the order.",
    },
    {
      kind: "invented-relationship",
      parts: [0, 3],
      text: "The two accounts jointly explain how Monday's rain caused Tuesday's bell to precede the bridge closure. Their shared recollection of the weather supplies the missing causal link.",
    },
    {
      kind: "early-only",
      parts: [0],
      text: "The narrative reconstructs Tuesday through Mira's memory of hearing the bell after the bridge closed. Her account gives the episode its coherent sequence, linking the remembered sound to an already completed closure.",
    },
    {
      kind: "flattened-disagreement",
      parts: [0, 1, 2],
      text: "Mira, Ivo and the maintenance record agree that the bell rang before the bridge closed. Their accounts differ only in the amount of detail, not in the established sequence.",
    },
    {
      kind: "unsupported-overstated",
      parts: [2],
      text: "The dated maintenance slip gives an exact, independently verified time for both events. It proves that the narrator's remaining uncertainty is unnecessary.",
    },
  ],
  inapplicable: [],
}
