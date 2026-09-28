import { approved, exportProjection } from "./fixture.ts"

export const printRevision = approved({
  ...exportProjection,
  sections: exportProjection.sections.map((section) => ({
    ...section,
    practice: section.practice.map((exercise) => ({
      ...exercise,
      kind: "topic",
      scenario: { en: "A fictional conversation.", ja: "架空の会話です。" },
      attribution: { en: "Synthetic author commentary.", ja: "架空の著者による解説です。" },
    })),
    sourceNotes: [
      {
        id: "reference",
        title: { en: "Synthetic source", ja: "架空の出典" },
        locator: "chapter-one / paragraph 2",
        quotation: "An exact synthetic quotation.",
        note: { en: "Distinguish evidence from interpretation.", ja: "根拠と解釈を区別します。" },
      },
    ],
  })),
})
