import { z } from "zod"

const Score = z.number().int().min(0).max(2)
const Text = z.string().trim().min(1)
const Flag = z.union([z.boolean(), z.literal("unresolved")])
export const DimensionScores = z.strictObject({
  "purpose-progression": Score,
  "concepts-definitions": Score,
  "relationships-conflicts": Score,
  "qualifications-uncertainty": Score,
  "original-support": Score,
  "author-application": Score,
  "language-readability": Score,
})
export const CriticalFlags = z.strictObject({
  "incomplete-included-processing": Flag,
  "material-retained-claim-error": Flag,
  "missed-seeded-late-reversal": Flag,
  "unresolved-retained-citation": Flag,
  "unauthorized-authority-change": Flag,
  "missed-seeded-critical-negative": z.union([Flag, z.literal("post-reference")]),
})
export const ChapterDecision = z.strictObject({
  partOrdinal: z.number().int().min(1).max(4),
  decision: z.enum([
    "faithfully-represented",
    "appropriately-absent",
    "misrepresented",
    "materially-omitted",
    "unresolved",
  ]),
  originalGrounding: Text,
  reason: Text,
})
export const RubricInput = z
  .strictObject({
    dimensionScores: DimensionScores,
    criticalFlags: CriticalFlags,
    languagesProvided: z
      .array(z.enum(["en", "ja"]))
      .min(1)
      .max(2),
    enJaApplicability: z.enum(["applies", "not-supplied", "unresolved"]),
    languageApplicabilityReason: Text,
    chapters: z.array(ChapterDecision).length(4),
  })
  .superRefine((value, ctx) => {
    if (
      new Set(value.languagesProvided).size !== value.languagesProvided.length ||
      new Set(value.chapters.map((row) => row.partOrdinal)).size !== 4
    )
      ctx.addIssue({ code: "custom", message: "Duplicate language/chapter" })
    const both = value.languagesProvided.includes("en") && value.languagesProvided.includes("ja")
    if (
      (value.enJaApplicability === "applies" && !both) ||
      (value.enJaApplicability === "not-supplied" && both)
    )
      ctx.addIssue({ code: "custom", message: "Language applicability mismatch" })
  })
export type RubricInput = z.infer<typeof RubricInput>
