import type { FamilyNarrative } from "./control-types.ts"
export const definitionsNarrative: FamilyNarrative = {
  family: "definitions",
  parts: [
    {
      role: "definitions",
      text: "This is a terminology register, not a policy proposal. One slot is a scheduled berth interval, and one visit can occupy two slots.",
    },
    {
      role: "examples",
      text: "The table distinguishes slots from visits: Reed has six slots for three visits, while Stone has four for four; matching column values are not a general identity of units.",
    },
    {
      role: "definitions",
      text: "A missing entry means unrecorded rather than zero, so a blank cannot establish that no boat arrived.",
    },
    {
      role: "qualifications",
      text: "The two fictional references, at pages8 and2, supply no recommendation to increase traffic.",
    },
  ],
  full: "The register distinguishes berth-time slots, boat visits and missing observations without advocating traffic policy. Reed's six slots/three visits and Stone's four/four illustrate different units; blanks do not prove zero arrivals, and the cited references recommend no expansion.",
  concise:
    "Slots and visits are different units—six/three for Reed, four/four for Stone. Missing records are not zero arrivals; this reference register does not recommend expanding traffic.",
  omittedImmaterialDetail:
    "Fictional reference titles and page numbers8/2; proposed as immaterial to the concise synthesis, subject to human corroboration.",
  negatives: [
    {
      kind: "quote-false-conclusion",
      quote: "A visit may occupy two slots.",
      parts: [0],
      text: "“A visit may occupy two slots.” Therefore every visit necessarily uses two intervals, so all slot totals can be divided by two to recover the visit count.",
    },
    {
      kind: "omitted-exception",
      parts: [1, 2],
      text: "The table gives an accounting method for arrivals: count occupied slots, and treat an empty entry as no recorded boat activity. Blank cells consequently establish zero arrivals for the category.",
    },
    {
      kind: "invented-relationship",
      parts: [1, 3],
      text: "The references explain the table's recommendation: Reed's larger slot total supports expanding traffic there, while Stone's matching totals show that its capacity should remain unchanged.",
    },
    {
      kind: "early-only",
      parts: [0],
      text: "The register presents berth scheduling through the relation between visits and intervals. Its organizing lesson is that a single visit can span multiple slots, providing a compact vocabulary for describing how boats use the berths.",
    },
    {
      kind: "unsupported-overstated",
      parts: [1],
      text: "Reed received six visits and Stone four. These figures establish both the arrival totals and the amount of unused capacity in each category.",
    },
  ],
  inapplicable: [
    {
      kind: "flattened-disagreement",
      reason:
        "The original is a register distinguishing units, not competing speakers/accounts. Inventing an original disagreement to flatten would change the corpus. The human must corroborate this applicability decision.",
    },
  ],
}
