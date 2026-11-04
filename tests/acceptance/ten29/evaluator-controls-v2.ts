const claim = "EARLY: A pause may invite a reply."
const counter = "LATE: 沈黙は同意とは限らない。Silence is not agreement."
const supplement = "SUPPLEMENT: 新参者を排除しうる。Pauses can exclude newcomers."
const resource = (title: string | null, paragraphs: readonly string[], supplementary = false) => ({
  title,
  paragraphs,
  supplementary,
})
const headed = [
  resource("Early chapter", [claim]),
  resource("Intervening chapter", [
    "INTERVAL: A diary records a pause; its meaning is unresolved.",
  ]),
  resource("Late chapter", [counter]),
  resource("Supplement", [supplement], true),
]
const windowBody = `${claim} Cafe\u0301 🧭 ${"日記の記録。".repeat(1800)} ${counter}`

export const evaluatorV2Provenance = {
  version: "TEN29-offline-context-controls-v2",
  authorOverlap: "same driver; originals/held-outs already seen",
  independentHiddenLabels: false,
  newFixtures: true,
  purpose: "literal original-evidence availability, not semantic scoring",
  originalFreezeUnchanged: true,
  assertionStatus: "current baseline characterization, not product acceptance",
  documentedSelectorControls: ["within-512-mixed", "beyond-512-mixed", "beyond-adjacent-block"],
  documentedSelectorStatus: "characterizes documented TEN26 radius/neighbor behavior; not a defect",
  nonlocalG1Controls: ["four-maps-no-qualifications", "multi-window-no-qualification"],
  nonlocalRepairRequirement:
    "if broader review is separately authorized, required nonlocal originals must become present; radius utility assertions need not change",
  mapOmissionGap: "no current stage evaluates material content a map left out",
} as const
export const evaluatorContextControls = [
  {
    id: "within-512-mixed",
    resources: [resource(null, [`${claim}${"x".repeat(450)}${counter}`])],
    claim,
    required: [{ id: "late-exception", text: counter }],
    keepQualifications: false,
    expectedMissing: [],
    minimumMaps: 1,
    expectedGroups: 1,
  },
  {
    id: "beyond-512-mixed",
    resources: [resource(null, [`${claim}${"x".repeat(700)}${counter}`])],
    claim,
    required: [{ id: "late-exception", text: counter }],
    keepQualifications: false,
    expectedMissing: ["late-exception"],
    minimumMaps: 1,
    expectedGroups: 1,
  },
  {
    id: "beyond-adjacent-block",
    resources: [
      resource(null, [claim, "INTERVAL: The next block contains no resolution.", counter]),
    ],
    claim,
    required: [{ id: "late-exception", text: counter }],
    keepQualifications: false,
    expectedMissing: ["late-exception"],
    minimumMaps: 1,
    expectedGroups: 1,
  },
  {
    id: "four-maps-no-qualifications",
    resources: headed,
    claim,
    required: [
      { id: "late-exception", text: counter },
      { id: "supplement-counterargument", text: supplement },
    ],
    keepQualifications: false,
    expectedMissing: ["late-exception", "supplement-counterargument"],
    minimumMaps: 4,
    expectedGroups: 4,
  },
  {
    id: "four-maps-retained-qualifications",
    resources: headed,
    claim,
    required: [
      { id: "late-exception", text: counter },
      { id: "supplement-counterargument", text: supplement },
    ],
    keepQualifications: true,
    expectedMissing: [],
    minimumMaps: 4,
    expectedGroups: 4,
  },
  {
    id: "multi-window-no-qualification",
    resources: [resource("Long mixed chapter", [windowBody])],
    claim,
    required: [{ id: "late-exception", text: counter }],
    keepQualifications: false,
    expectedMissing: ["late-exception"],
    minimumMaps: 2,
    expectedGroups: 1,
  },
  {
    id: "multi-window-retained-qualification",
    resources: [resource("Long mixed chapter", [windowBody])],
    claim,
    required: [{ id: "late-exception", text: counter }],
    keepQualifications: true,
    expectedMissing: [],
    minimumMaps: 2,
    expectedGroups: 1,
  },
] as const
export type ContextControl = (typeof evaluatorContextControls)[number]
