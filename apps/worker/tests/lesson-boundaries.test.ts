import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { generateFixtureLesson } from "@reading-studio/generation/lesson"
import { openStorage, type Storage } from "@reading-studio/storage"
import { afterEach, beforeEach, expect, it } from "vitest"
import { lessonFixture } from "./lesson-fixture.ts"

let storage: Storage
let directory: string
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "lesson-boundary-"))
  storage = openStorage({ databasePath: join(directory, "db"), privateDataRoot: directory })
})
afterEach(() => {
  storage.close()
  rmSync(directory, { recursive: true, force: true })
})

it("rejects a caveat replacement when an approved qualification would disappear", () => {
  // Given
  const fixture = lessonFixture(storage)
  storage.outlines.decide({ studyId: "study-1", revisionId: fixture.outline.id, action: "approve" })
  const draft = {
    ...fixture.draft,
    sections: fixture.draft.sections.map((section) => ({
      ...section,
      caveats: section.caveats.map((caveat) => ({ ...caveat, id: "unrelated-caveat" })),
    })),
  }
  // When / Then
  expect(() => generateFixtureLesson(storage, fixture.request, draft)).toThrow(
    "missing-qualification",
  )
  expect(storage.counts().lessons).toBe(0)
})

it("rejects missing assumptions on a teaching model even when scene assumptions exist", () => {
  // Given
  const fixture = lessonFixture(storage)
  storage.outlines.decide({ studyId: "study-1", revisionId: fixture.outline.id, action: "approve" })
  const draft = {
    ...fixture.draft,
    sections: fixture.draft.sections.map((section) => ({
      ...section,
      blocks: section.blocks.map((block) => ({ ...block, assumptions: [] })),
    })),
  }
  // When / Then
  expect(() => generateFixtureLesson(storage, fixture.request, draft)).toThrow("assumptions")
})

it("rejects borrowed evidence in a teaching block even when the section citation is valid", () => {
  // Given
  const fixture = lessonFixture(storage)
  storage.outlines.decide({ studyId: "study-1", revisionId: fixture.outline.id, action: "approve" })
  const draft = {
    ...fixture.draft,
    sections: fixture.draft.sections.map((section) => ({
      ...section,
      blocks: section.blocks.map((block) => ({
        ...block,
        attribution: {
          kind: "author-claim",
          sources: [{ ...fixture.span, editionId: "other-book" }],
        },
      })),
    })),
  }
  // When / Then
  expect(() => generateFixtureLesson(storage, fixture.request, draft)).toThrow("invalid-citation")
})

it.each([true, false])(
  "requires dedicated approved visual evidence for a source-grounded scene (valid=%s)",
  (valid) => {
    // Given
    const fixture = lessonFixture(storage)
    const outline = storage.outlines.save({
      studyId: "study-1",
      briefRevisionId: fixture.outline.briefRevisionId,
      expectedRevisionId: fixture.outline.id,
      feedback: null,
      content: {
        ...fixture.outline.content,
        sections: fixture.outline.content.sections.map((section) => ({
          ...section,
          visualKind: "source-grounded",
          visualEvidence: [fixture.span],
        })),
      },
    })
    storage.outlines.decide({ studyId: "study-1", revisionId: outline.id, action: "approve" })
    const draft = {
      ...fixture.draft,
      outlineRevisionId: outline.id,
      sections: fixture.draft.sections.map((section) => ({
        ...section,
        sceneNotes: section.sceneNotes.map((note) => ({
          ...note,
          attribution: valid
            ? { kind: "interpretation", sources: [fixture.span] }
            : { kind: "illustrative-model" },
        })),
      })),
    }
    const request = { ...fixture.request, outlineRevisionId: outline.id }
    // When / Then
    if (valid)
      expect(generateFixtureLesson(storage, request, draft).lesson.sections).toHaveLength(1)
    else expect(() => generateFixtureLesson(storage, request, draft)).toThrow("scene-attribution")
  },
)

it("rejects generation when the approved brief has been withdrawn", () => {
  // Given
  const fixture = lessonFixture(storage)
  storage.outlines.decide({ studyId: "study-1", revisionId: fixture.outline.id, action: "approve" })
  storage.briefs.decide({
    studyId: "study-1",
    revisionId: fixture.outline.briefRevisionId,
    action: "revise",
  })
  // When / Then
  expect(() => generateFixtureLesson(storage, fixture.request, fixture.draft)).toThrow(
    "current-outline-required",
  )
})
