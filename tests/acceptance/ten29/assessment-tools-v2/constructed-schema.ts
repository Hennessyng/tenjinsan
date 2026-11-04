import { z } from "zod"
export const ControlKind = z.enum([
  "quote-false-conclusion",
  "omitted-exception",
  "invented-relationship",
  "early-only",
  "flattened-disagreement",
  "unsupported-overstated",
])
export const ConstructedLabel = z
  .strictObject({
    label: z.enum(["faithful", "negative"]),
    critical: z.boolean(),
    kind: ControlKind.nullable(),
    authorReason: z.string().trim().min(1),
    status: z.literal("PROVISIONAL SAME-AUTHOR CONSTRUCTION"),
  })
  .superRefine((value, ctx) => {
    if (
      (value.label === "faithful" && (value.critical || value.kind !== null)) ||
      (value.label === "negative" && value.kind === null)
    )
      ctx.addIssue({ code: "custom", message: "Invalid constructed label/criticality" })
  })
const Fact = z.union([z.boolean(), z.literal("unresolved")])
export const TechnicalEvidence = z.strictObject({
  evidenceDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  incompleteIncludedProcessing: Fact,
  unauthorizedAuthorityChange: Fact,
  citationLocationsResolved: Fact,
  scope: z.string().trim().min(1),
  semanticCitationSupport: z.literal("NOT ASSESSED; human source-faithfulness judgment required"),
})
