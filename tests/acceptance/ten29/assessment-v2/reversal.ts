import type { FamilyNarrative } from "./control-types.ts"
export const reversalNarrative: FamilyNarrative = {
  family: "reversal",
  parts: [
    {
      role: "claims",
      text: "The council initially proposes universal dawn opening after ten boats pass without delay in the first trial.",
    },
    {
      role: "qualifications",
      text: "The observations cover dry mornings only; without flood measurements, speed cannot establish safety.",
    },
    {
      role: "qualifications",
      text: "Wet-season flooding damages the lower gardens, so the council withdraws the universal rule and requires a local water-level check.",
    },
    {
      role: "qualifications",
      text: "The appendix corrects the earlier empty-garden report: the flooded lower gardens were occupied.",
    },
  ],
  full: "A narrow dry-morning trial motivates a universal dawn proposal, but its evidence cannot establish flood safety. Wet-season flooding then reverses the universal rule in favor of local water-level checks; the correction that the gardens were occupied strengthens the importance of that reversal.",
  concise:
    "Dry-weather speed does not establish safety: after flooding occupied gardens, the council replaces universal dawn opening with a local water-level condition.",
  omittedImmaterialDetail:
    "Exact count of ten delay-free boats; proposed as immaterial to the concise argument, subject to human corroboration.",
  negatives: [
    {
      kind: "quote-false-conclusion",
      quote: "The first trial moved ten boats without delay.",
      parts: [0],
      text: "“The first trial moved ten boats without delay.” This direct evidence establishes that dawn opening is safe in every season, so the council's universal rule is justified.",
    },
    {
      kind: "omitted-exception",
      parts: [0, 2],
      text: "The council's operative recommendation is to open every gate at dawn. Later trials refine local implementation but leave that universal recommendation intact.",
    },
    {
      kind: "invented-relationship",
      parts: [0, 3],
      text: "The appendix establishes why the first trial was fast: empty lower gardens allowed unrestricted dawn opening. The trial therefore demonstrates how garden occupancy controls boat speed.",
    },
    {
      kind: "early-only",
      parts: [0],
      text: "The council develops a practical dawn-opening policy from a successful trial of ten boats. Its central achievement is translating observed efficiency into a clear rule for every gate, giving operators a consistent daily procedure.",
    },
    {
      kind: "flattened-disagreement",
      parts: [2, 3],
      text: "The trial report and appendix agree that the lower gardens were empty. The later account merely adds descriptive detail, without correcting the evidence on which the original opening rule relied.",
    },
    {
      kind: "unsupported-overstated",
      parts: [1, 2],
      text: "A local water-level check guarantees that opening cannot flood the gardens. The council has thereby demonstrated a safe procedure for all weather conditions.",
    },
  ],
  inapplicable: [],
}
