import {
  assertNever,
  type LessonAttribution,
  type OutlineDraft,
  type SourceSpan,
} from "@reading-studio/contracts"
import { type LessonFixtureDraft, LessonGenerationError } from "./lesson-contracts.ts"

export function attributionSources(attribution: LessonAttribution): readonly SourceSpan[] {
  switch (attribution.kind) {
    case "author-claim":
    case "interpretation":
      return attribution.sources
    case "original-example":
    case "illustrative-model":
      return []
    default:
      return assertNever(attribution)
  }
}

export function validateLessonDraft(outline: OutlineDraft, draft: LessonFixtureDraft) {
  if (draft.outlineRevisionId !== outline.id) throw new LessonGenerationError("revision-mismatch")
  if (draft.sections.length !== outline.content.sections.length)
    throw new LessonGenerationError("section-mismatch")
  for (const [index, section] of draft.sections.entries()) {
    const approved = outline.content.sections[index]
    if (
      !approved ||
      section.id !== approved.id ||
      JSON.stringify(section.title) !== JSON.stringify(approved.title)
    )
      throw new LessonGenerationError("section-mismatch")
    const allowed = new Set(
      [
        ...approved.sources,
        ...approved.visualEvidence,
        ...outline.content.qualifications.flatMap((item) => item.sources),
      ].map((span) => JSON.stringify(span)),
    )
    const used = [
      ...attributionSources(section.attribution),
      ...section.blocks.flatMap((block) => attributionSources(block.attribution)),
      ...section.caveats.flatMap((caveat) => caveat.sources),
      ...section.sceneNotes.flatMap((note) => attributionSources(note.attribution)),
    ]
    if (used.some((span) => !allowed.has(JSON.stringify(span))))
      throw new LessonGenerationError("invalid-citation")
    if (
      section.practice.length === 0 ||
      (approved.visualIntents.length > 0 && section.scenes.length === 0)
    )
      throw new LessonGenerationError("teaching-required")
    if (
      section.sceneNotes.length !== section.scenes.length ||
      section.scenes.some((scene) => !section.sceneNotes.some((note) => note.id === scene.id))
    )
      throw new LessonGenerationError("scene-attribution")
    for (const note of section.sceneNotes) {
      switch (approved.visualKind) {
        case "illustrative-model":
          if (note.attribution.kind !== "illustrative-model")
            throw new LessonGenerationError("scene-attribution")
          break
        case "source-grounded": {
          const sources = attributionSources(note.attribution)
          const visual = new Set(approved.visualEvidence.map((span) => JSON.stringify(span)))
          if (sources.length === 0 || sources.some((span) => !visual.has(JSON.stringify(span))))
            throw new LessonGenerationError("scene-attribution")
          break
        }
        default:
          assertNever(approved.visualKind)
      }
    }
  }
  for (const qualification of outline.content.qualifications) {
    const retained = draft.sections
      .flatMap((section) => section.caveats)
      .some(
        (caveat) =>
          caveat.id === qualification.id &&
          JSON.stringify(caveat.sources) === JSON.stringify(qualification.sources),
      )
    if (!retained) throw new LessonGenerationError("missing-qualification")
  }
}
