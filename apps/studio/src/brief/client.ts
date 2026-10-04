import { z } from "zod"

const Pair = z.object({ en: z.string(), ja: z.string() })
const Scope = z.object({
  kind: z.enum(["partial", "all-main-chapters"]),
  selected: z.array(z.object({ resourcePath: z.string(), blockIds: z.array(z.string()) })),
  exclusions: z.array(z.object({ resourcePath: z.string(), blockIds: z.array(z.string()) })),
})
export const BriefState = z.object({
  view: z
    .object({
      status: z.enum(["pending", "approved", "revise", "defer", "outdated"]),
      draft: z.object({
        id: z.string(),
        scope: Scope,
        content: z.object({
          originalQuestion: Pair,
          refinedQuestion: Pair.nullable(),
          questionChoice: z.enum(["original", "refined"]),
          supportingQuestions: z.array(Pair),
          purpose: z.string(),
          context: z.string(),
          depth: z.enum(["overview", "focused", "deep"]),
          language: z.enum(["en", "ja", "paired"]),
          spoilerPolicy: z.enum(["avoid", "allow"]),
          exclusions: z.array(z.string()),
        }),
      }),
    })
    .nullable(),
  setup: z.object({ studyId: z.string(), analysis: z.object({ scope: Scope }) }),
  descendants: z.array(z.object({ id: z.string(), kind: z.string(), status: z.string() })),
})
export type Brief = z.infer<typeof BriefState>

export const BriefSave = z.strictObject({
  action: z.literal("save"),
  expectedRevisionId: z.string(),
  originalEn: z.string(),
  originalJa: z.string(),
  refinedEn: z.string(),
  refinedJa: z.string(),
  supportEn0: z.string(),
  supportJa0: z.string(),
  supportEn1: z.string(),
  supportJa1: z.string(),
  supportEn2: z.string(),
  supportJa2: z.string(),
  purpose: z.string(),
  context: z.string(),
  questionChoice: z.enum(["original", "refined"]),
  depth: z.enum(["overview", "focused", "deep"]),
  language: z.enum(["en", "ja", "paired"]),
  spoilerPolicy: z.enum(["avoid", "allow"]),
  exclusions: z.string(),
})
export const BriefDecision = z.strictObject({
  action: z.enum(["approve", "revise", "defer"]),
  revisionId: z.string(),
})
