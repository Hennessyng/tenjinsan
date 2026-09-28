import { LessonRevision, type SourceSpan } from "@reading-studio/contracts"
import type { Storage } from "@reading-studio/storage"
import { LessonFixtureDraft, LessonGenerationError, LessonRequest } from "./lesson-contracts.ts"
import { validateLessonDraft } from "./lesson-validation.ts"

export { LessonFixtureDraft, LessonGenerationError } from "./lesson-contracts.ts"

export function generateFixtureLesson(
  storage: Storage,
  rawRequest: unknown,
  fixtureOutput: unknown,
) {
  return Object.freeze({
    provider: "fixture" as const,
    lesson: materializeLesson(storage, rawRequest, fixtureOutput),
  })
}

export function materializeLesson(storage: Storage, rawRequest: unknown, modelOutput: unknown) {
  const request = LessonRequest.parse(rawRequest)
  const current = storage.outlines.current(request.studyId)
  const outline = storage.outlines.approved(request.outlineRevisionId)
  if (current?.status !== "approved" || current.draft.id !== request.outlineRevisionId || !outline)
    throw new LessonGenerationError("current-outline-required")
  const draft = LessonFixtureDraft.parse(modelOutput)
  validateLessonDraft(current.draft, draft)
  const evidence = new Map<string, { readonly span: SourceSpan; readonly text: string }>()
  const spans = [
    ...current.draft.content.sections.flatMap((section) => [
      ...section.sources,
      ...section.visualEvidence,
    ]),
    ...current.draft.content.qualifications.flatMap((item) => item.sources),
  ]
  for (const span of spans) {
    const key = JSON.stringify(span)
    if (evidence.has(key)) continue
    const resolved = storage.sources.resolveSpan(storage.sources.appendSpan(span))
    if (!resolved) throw new LessonGenerationError("evidence-unavailable")
    evidence.set(key, resolved)
  }
  const sections = draft.sections.map(({ blocks, caveats, sceneNotes, ...section }, index) => {
    const approved = current.draft.content.sections[index]
    if (!approved) throw new LessonGenerationError("section-mismatch")
    const keys = new Set(
      [
        ...approved.sources,
        ...approved.visualEvidence,
        ...current.draft.content.qualifications.flatMap((item) => item.sources),
      ].map((span) => JSON.stringify(span)),
    )
    return {
      ...section,
      reviewerFlags: [],
      teaching: {
        learningGoals: approved.learningGoals,
        visualIntents: approved.visualIntents,
        excludedAreas: current.draft.content.excludedAreas,
        blocks,
        caveats,
        sceneNotes,
        sources: [...evidence.entries()].filter(([key]) => keys.has(key)).map(([, value]) => value),
      },
    }
  })
  const lesson = LessonRevision.parse({
    id: request.lessonRevisionId,
    studyId: outline.studyId,
    setupRevisionId: outline.setupRevisionId,
    analysisRevisionId: outline.analysisRevisionId,
    briefRevisionId: outline.briefRevisionId,
    outlineRevisionId: outline.id,
    sections,
    coverage: {
      kind: "complete-approved-scope",
      sources: [...evidence.values()].map((item) => item.span),
      limitations: draft.sections.flatMap((section) =>
        section.caveats.map((caveat) => caveat.text),
      ),
    },
  })
  storage.workflow.appendLesson({ parentRevisionId: null, record: lesson })
  return lesson
}
