import {
  ContentId,
  LessonAttribution,
  LessonBlock,
  LessonCaveat,
  LessonRevisionId,
  LessonSceneNote,
  LessonSection,
  OutlineRevisionId,
  StudyId,
  uniqueItems,
} from "@reading-studio/contracts"
import { z } from "zod"

export const LessonRequest = z
  .strictObject({
    studyId: StudyId,
    outlineRevisionId: OutlineRevisionId,
    lessonRevisionId: LessonRevisionId,
  })
  .readonly()
export const LessonFixtureDraft = z
  .strictObject({
    outlineRevisionId: OutlineRevisionId,
    sections: uniqueItems(
      LessonSection.unwrap()
        .omit({ reviewerFlags: true, teaching: true })
        .extend({
          id: ContentId,
          attribution: LessonAttribution,
          blocks: uniqueItems(LessonBlock).refine((values) => values.length > 0),
          caveats: uniqueItems(LessonCaveat).refine((values) => values.length > 0),
          sceneNotes: uniqueItems(LessonSceneNote),
        })
        .readonly(),
    ).refine((values) => values.length > 0),
  })
  .readonly()
export type LessonFixtureDraft = z.infer<typeof LessonFixtureDraft>
export class LessonGenerationError extends Error {
  override readonly name = "LessonGenerationError"
  constructor(
    readonly code:
      | "current-outline-required"
      | "revision-mismatch"
      | "section-mismatch"
      | "invalid-citation"
      | "missing-qualification"
      | "scene-attribution"
      | "teaching-required"
      | "evidence-unavailable",
  ) {
    super(code)
  }
}
