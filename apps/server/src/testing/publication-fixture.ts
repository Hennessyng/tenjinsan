import { changeEvidenceReview, openEvidenceReview } from "@reading-studio/generation/review"
import { evidenceFixture } from "./evidence-fixture.ts"

export async function publicationFixture() {
  const fixture = await evidenceFixture()
  const { storage, lesson } = fixture
  let view = openEvidenceReview(storage, lesson.id)
  view = changeEvidenceReview(storage, lesson.id, {
    action: "replace-text",
    expectedId: view.draft.id,
    path: "/sections/0/content/en",
    text: "Ask a colleague what they heard.",
  })
  for (const category of ["support", "qualification", "translation", "visual"] as const)
    view = changeEvidenceReview(storage, lesson.id, {
      action: "semantic",
      category,
      status: "acknowledged",
      expectedId: view.draft.id,
    })
  view = changeEvidenceReview(storage, lesson.id, {
    action: "privacy-reviewed",
    expectedId: view.draft.id,
  })
  return { ...fixture, view, path: `/publications/${lesson.studyId}` }
}
