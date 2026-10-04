import { z } from "zod"
import { AnalysisRevision } from "./lineage.ts"
import {
  Bilingual,
  BriefRevisionId,
  OutlineRevisionId,
  StudyId,
  Text,
  uniqueItems,
  uniqueValues,
} from "./primitives.ts"
import { SourceSpan } from "./source.ts"
import { OutlineSection } from "./workflow.ts"

export const OutlineContent = z
  .strictObject({
    title: Bilingual,
    theme: Bilingual,
    sections: uniqueItems(
      OutlineSection.unwrap()
        .extend({
          questionIndex: z.number().int().nonnegative(),
          visualKind: z.enum(["illustrative-model", "source-grounded"]),
          visualEvidence: z.array(SourceSpan).readonly().default([]),
          flags: uniqueValues(z.enum(["irrelevant-section", "unsupported-visual"])),
        })
        .readonly(),
    ).refine((sections) => sections.length > 0 && sections.length <= 12),
    qualifications: AnalysisRevision.unwrap().shape.qualifications,
    excludedAreas: uniqueValues(Text),
  })
  .readonly()
export type OutlineContent = z.infer<typeof OutlineContent>
export const OutlineFeedback = z
  .discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("choice"),
      value: z.enum(["reverse-order", "simplify-visuals"]),
    }),
    z.strictObject({ kind: z.literal("custom"), text: Text }),
  ])
  .readonly()
export type OutlineFeedback = z.infer<typeof OutlineFeedback>
export const OutlineSave = z
  .strictObject({
    studyId: StudyId,
    briefRevisionId: BriefRevisionId,
    expectedRevisionId: OutlineRevisionId.nullable(),
    content: OutlineContent,
    feedback: OutlineFeedback.nullable(),
  })
  .readonly()
export const OutlineDraft = OutlineSave.unwrap()
  .omit({ expectedRevisionId: true })
  .extend({
    id: OutlineRevisionId,
  })
  .readonly()
export type OutlineDraft = z.infer<typeof OutlineDraft>
export const OutlineDecision = z
  .strictObject({
    studyId: StudyId,
    revisionId: OutlineRevisionId,
    action: z.enum(["approve", "revise", "defer"]),
  })
  .readonly()
export type OutlineView = {
  readonly draft: OutlineDraft
  readonly status: "pending" | "approved" | "revise" | "defer" | "outdated"
}
