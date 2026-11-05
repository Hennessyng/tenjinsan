import { z } from "zod"

const Citation = z.strictObject({
  resourcePath: z.string(),
  blockId: z.string(),
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
})
export const FoundationStatement = z.strictObject({
  text: z.string().trim().min(1).max(2000),
  citations: z.array(Citation).min(1).max(32),
})
const Findings = z.array(FoundationStatement).max(64)
export const ChapterOutput = z.strictObject({
  complete: z.boolean(),
  claimStatus: z.enum(["claims", "no-claim", "uncertain"]),
  purpose: FoundationStatement.nullable(),
  claims: Findings,
  concepts: Findings,
  definitions: Findings,
  examples: Findings,
  qualifications: Findings,
  uncertainties: Findings,
  summary: FoundationStatement,
})
export type ChapterOutput = z.infer<typeof ChapterOutput>
export const SynthesisOutput = z.strictObject({
  complete: z.boolean(),
  representedGroupIds: z.array(z.string()).min(1).max(128),
  thesis: Findings,
  progression: Findings.min(1),
  connections: Findings,
  conflicts: Findings,
  changesOfPosition: Findings,
  uncertainties: Findings,
})
export type SynthesisOutput = z.infer<typeof SynthesisOutput>
