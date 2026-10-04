import { randomUUID } from "node:crypto"
import {
  assertNever,
  contentDigest,
  EvidenceAction,
  EvidenceDraft,
  EvidenceView,
  LessonRevisionId,
  projectedStrings,
  projectionHash,
  SemanticCategory,
} from "@reading-studio/contracts"
import { ContractBoundaryError, type Storage } from "@reading-studio/storage"
import { correctProjection } from "./review-correction.ts"
import { mechanicalReview } from "./review-mechanical.ts"
import { reviewPrivacy } from "./review-privacy.ts"
import { buildReviewProjection } from "./review-projection.ts"

export { reviewPrivacy } from "./review-privacy.ts"
export { buildReviewProjection, lessonSources } from "./review-projection.ts"

function currentLesson(storage: Storage, input: unknown) {
  const id = LessonRevisionId.parse(input)
  const lesson = storage.workflow.getLesson(id)
  if (
    !lesson ||
    storage.reviews.latestLessonId(lesson.studyId) !== id ||
    !storage.outlines.approved(lesson.outlineRevisionId)
  )
    throw new ContractBoundaryError("current approved lesson lineage")
  return lesson
}

function viewReview(storage: Storage, draft: EvidenceDraft): EvidenceView {
  const lesson = currentLesson(storage, draft.lessonRevisionId)
  const mechanical = mechanicalReview({
    lesson,
    projection: draft.projection,
    sources: storage.sources,
  })
  const privacy = reviewPrivacy(draft)
  const ready =
    !draft.keepPrivate &&
    mechanical.length === 0 &&
    privacy.status === "passed" &&
    draft.semantic.every((decision) => decision.status !== "unresolved")
  return EvidenceView.parse({
    draft,
    mechanical,
    privacy,
    ready,
    reportHash: contentDigest(
      JSON.stringify({
        lessonRevisionId: lesson.id,
        projectionHash: draft.projectionHash,
        semantic: draft.semantic,
        mechanical,
        privacy,
        keepPrivate: draft.keepPrivate,
      }),
    ),
  })
}

export function openEvidenceReview(storage: Storage, input: unknown): EvidenceView {
  const lesson = currentLesson(storage, input)
  const saved = storage.reviews.current(lesson.id)
  if (saved) return viewReview(storage, saved)
  const projection = buildReviewProjection(lesson, storage.sources)
  const brief = storage.briefs.approved(lesson.briefRevisionId)
  const draft = storage.reviews.append(
    {
      id: randomUUID(),
      studyId: lesson.studyId,
      lessonRevisionId: lesson.id,
      projection,
      projectionHash: projectionHash(projection),
      semantic: SemanticCategory.options.map((category) => ({ category, status: "unresolved" })),
      privateDetails: brief?.context.trim() ? [brief.context] : [],
      manualFlags: [],
      privacyReviewed: false,
      keepPrivate: false,
    },
    null,
  )
  return viewReview(storage, draft)
}

export function changeEvidenceReview(
  storage: Storage,
  input: unknown,
  rawAction: unknown,
): EvidenceView {
  const action = EvidenceAction.parse(rawAction)
  const before = openEvidenceReview(storage, input)
  if (action.expectedId !== before.draft.id)
    throw new ContractBoundaryError("stale evidence review")
  const draft = before.draft
  let next: EvidenceDraft
  switch (action.action) {
    case "replace-text":
      return changeEvidenceReview(storage, input, {
        action: "correct",
        expectedId: action.expectedId,
        projection: correctProjection(draft.projection, { path: action.path, text: action.text }),
      })
    case "remove-content":
      return changeEvidenceReview(storage, input, {
        action: "correct",
        expectedId: action.expectedId,
        projection: correctProjection(draft.projection, { path: action.path }),
      })
    case "correct": {
      const hash = projectionHash(action.projection)
      if (hash === draft.projectionHash) return before
      next = EvidenceDraft.parse({
        ...draft,
        projection: action.projection,
        projectionHash: hash,
        semantic: SemanticCategory.options.map((category) => ({ category, status: "unresolved" })),
        privacyReviewed: false,
        manualFlags: draft.manualFlags.filter((flag) =>
          projectedStrings(action.projection).some(
            (entry) => entry.path === flag.path && contentDigest(entry.text) === flag.textHash,
          ),
        ),
      })
      break
    }
    case "semantic":
      next = EvidenceDraft.parse({
        ...draft,
        semantic: draft.semantic.map((decision) =>
          decision.category === action.category
            ? { category: action.category, status: action.status }
            : decision,
        ),
      })
      break
    case "private-detail":
      next = EvidenceDraft.parse({
        ...draft,
        privateDetails: [...new Set([...draft.privateDetails, action.text])],
        privacyReviewed: false,
      })
      break
    case "privacy-flag": {
      const entry = projectedStrings(draft.projection).find((entry) => entry.path === action.path)
      if (!entry) throw new ContractBoundaryError("privacy path")
      next = EvidenceDraft.parse({
        ...draft,
        privacyReviewed: false,
        privateDetails: [...new Set([...draft.privateDetails, entry.text])],
        manualFlags: [
          ...draft.manualFlags,
          { path: entry.path, textHash: contentDigest(entry.text) },
        ],
      })
      break
    }
    case "privacy-reviewed":
      if (before.privacy.findings.length > 0)
        throw new ContractBoundaryError("unresolved privacy flags")
      next = EvidenceDraft.parse({ ...draft, privacyReviewed: true })
      break
    case "keep-private":
      next = EvidenceDraft.parse({ ...draft, keepPrivate: true })
      break
    default:
      return assertNever(action)
  }
  const saved = storage.reviews.append({ ...next, id: randomUUID() }, draft.id)
  return viewReview(storage, saved)
}
