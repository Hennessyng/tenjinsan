import { z } from "zod"
import { CandidateCode, Digest, DocumentCode, Mode, Text } from "./workflow-schema.ts"
export const CoverageKind = z.enum([
  "quote-false-conclusion",
  "omitted-exception",
  "invented-relationship",
  "early-only",
  "flattened-disagreement",
  "unsupported-overstated",
])
export const HumanCoverage = z
  .strictObject({
    kind: z.literal("human-critical-coverage"),
    mode: Mode,
    packetDigest: Digest,
    humanId: Text,
    documentCode: DocumentCode,
    referenceSetDigest: Digest,
    rows: z
      .array(
        z.strictObject({
          kind: CoverageKind,
          applicability: z.enum(["applicable", "not-applicable", "unresolved"]),
          candidateCodes: z.array(CandidateCode),
          originalGroundedReason: Text,
        }),
      )
      .length(6),
    humanAuthorshipAttestation: z.literal(true),
    completedAt: z.string().datetime(),
  })
  .superRefine((value, ctx) => {
    if (
      new Set(value.rows.map((row) => row.kind)).size !== 6 ||
      value.rows.some(
        (row) =>
          new Set(row.candidateCodes).size !== row.candidateCodes.length ||
          (row.applicability === "applicable" && row.candidateCodes.length === 0) ||
          (row.applicability === "not-applicable" && row.candidateCodes.length > 0),
      )
    )
      ctx.addIssue({ code: "custom", message: "Incomplete/duplicate coverage applicability" })
  })
export type HumanCoverage = z.infer<typeof HumanCoverage>
export const CoverageAdjudication = z.strictObject({
  kind: z.literal("coverage-adjudication"),
  mode: Mode,
  packetDigest: Digest,
  humanId: Text,
  documentCode: DocumentCode,
  coverageDigest: Digest,
  conclusion: z.enum(["uphold-constructed", "overturn-constructed", "unresolved"]),
  originalGroundedReason: Text,
  completedAt: z.string().datetime(),
})
export type CoverageAdjudication = z.infer<typeof CoverageAdjudication>
