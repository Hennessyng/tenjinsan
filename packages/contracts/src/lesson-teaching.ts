import { z } from "zod"
import { Bilingual, ContentId, SceneId, Text, uniqueItems } from "./primitives.ts"
import { SourceSpan } from "./source.ts"

export const LessonAttribution = z
  .discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("author-claim"),
      sources: z.array(SourceSpan).min(1).readonly(),
    }),
    z.strictObject({
      kind: z.literal("interpretation"),
      sources: z.array(SourceSpan).min(1).readonly(),
    }),
    z.strictObject({ kind: z.literal("original-example") }),
    z.strictObject({ kind: z.literal("illustrative-model") }),
  ])
  .readonly()
export type LessonAttribution = z.infer<typeof LessonAttribution>

export const TeachingAttribution = z
  .strictObject({
    attribution: LessonAttribution,
    assumptions: z.array(Bilingual).readonly(),
  })
  .refine(
    (value) => value.attribution.kind !== "illustrative-model" || value.assumptions.length > 0,
    "illustrative models require explicit assumptions",
  )

export const LessonBlock = TeachingAttribution.safeExtend({
  id: ContentId,
  label: Bilingual,
  content: Bilingual,
}).readonly()
export const LessonSceneNote = TeachingAttribution.safeExtend({ id: SceneId }).readonly()
export const LessonCaveat = z
  .strictObject({
    id: ContentId,
    text: Bilingual,
    sources: z.array(SourceSpan).min(1).readonly(),
  })
  .readonly()
export const RetrievedLessonSource = z.strictObject({ span: SourceSpan, text: Text }).readonly()
export const LessonTeaching = z
  .strictObject({
    learningGoals: z.array(Bilingual).min(1).readonly(),
    visualIntents: z.array(Bilingual).readonly(),
    excludedAreas: z.array(Text).readonly(),
    blocks: uniqueItems(LessonBlock).refine((blocks) => blocks.length > 0),
    caveats: uniqueItems(LessonCaveat).refine((caveats) => caveats.length > 0),
    sceneNotes: uniqueItems(LessonSceneNote),
    sources: z.array(RetrievedLessonSource).min(1).readonly(),
  })
  .readonly()
