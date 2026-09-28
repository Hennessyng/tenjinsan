import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { generateFixtureLesson } from "@reading-studio/generation/lesson"
import { openEvidenceReview } from "@reading-studio/generation/review"
import { openStorage } from "@reading-studio/storage"
import { expect, it } from "vitest"
import { lessonFixture } from "./lesson-fixture.ts"

it("builds navigation from stored chapter inventory when opening a lesson", () => {
  // Given
  const root = mkdtempSync(join(tmpdir(), "practice-map-"))
  const storage = openStorage({ databasePath: join(root, "db.sqlite"), privateDataRoot: root })
  try {
    const fixture = lessonFixture(storage)
    storage.outlines.decide({
      studyId: "study-1",
      revisionId: fixture.outline.id,
      action: "approve",
    })
    const { lesson } = generateFixtureLesson(storage, fixture.request, fixture.draft)
    // When
    const projection = openEvidenceReview(storage, lesson.id).draft.projection
    // Then
    expect(projection.bookMap?.length).toBeGreaterThan(0)
    expect(projection.bookMap?.some((chapter) => chapter.sectionIds.length > 0)).toBe(true)
  } finally {
    storage.close()
    rmSync(root, { recursive: true, force: true })
  }
})
