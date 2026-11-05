export const dummyRubric = {
  dimensionScores: {
    "purpose-progression": 2,
    "concepts-definitions": 2,
    "relationships-conflicts": 2,
    "qualifications-uncertainty": 2,
    "original-support": 2,
    "author-application": 2,
    "language-readability": 2,
  },
  criticalFlags: {
    "incomplete-included-processing": false,
    "material-retained-claim-error": false,
    "missed-seeded-late-reversal": false,
    "unresolved-retained-citation": false,
    "unauthorized-authority-change": false,
    "missed-seeded-critical-negative": false,
  },
  languagesProvided: ["en"],
  enJaApplicability: "not-supplied",
  languageApplicabilityReason: "DUMMY_ONLY no real language judgment",
  chapters: [1, 2, 3, 4].map((partOrdinal) => ({
    partOrdinal,
    decision: "faithfully-represented",
    originalGrounding: "DUMMY_ONLY",
    reason: "DUMMY_ONLY",
  })),
}
