import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { OutlineRevisionId } from "@reading-studio/contracts"
import { generateFixtureLesson } from "@reading-studio/generation/lesson"
import { openStorage, type Storage } from "@reading-studio/storage"
import { afterEach, beforeEach, expect, it } from "vitest"
import { lessonFixture } from "./lesson-fixture.ts"

let storage: Storage
let directory: string
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "lesson-19-"))
  storage = openStorage({ databasePath: join(directory, "db"), privateDataRoot: directory })
})
afterEach(() => {
  storage.close()
  rmSync(directory, { recursive: true, force: true })
})

it("persists paired teaching and retrieved evidence when the exact outline is approved", () => {
  // Given
  const fixture = lessonFixture(storage)
  storage.outlines.decide({ studyId: "study-1", revisionId: fixture.outline.id, action: "approve" })
  // When
  const result = generateFixtureLesson(storage, fixture.request, fixture.draft)
  storage.close()
  storage = openStorage({ databasePath: join(directory, "db"), privateDataRoot: directory })
  // Then
  expect(storage.workflow.getLesson(result.lesson.id)).toEqual(result.lesson)
  expect(result.provider).toBe("fixture")
  expect(result.lesson.sections[0]?.teaching?.sources).toEqual([
    { span: fixture.span, text: fixture.text },
  ])
  expect(
    result.lesson.sections[0]?.teaching?.blocks.map((block) => block.attribution.kind),
  ).toEqual(["author-claim", "interpretation", "original-example", "illustrative-model"])
  expect(result.lesson.sections[0]?.practice).toEqual(fixture.draft.sections[0]?.practice)
  expect(result.lesson.sections[0]?.scenes).toEqual(fixture.draft.sections[0]?.scenes)
  expect(result.lesson.sections[0]?.teaching?.caveats).toEqual(fixture.draft.sections[0]?.caveats)
})

it("rejects generation when outline approval is pending", () => {
  // Given
  const fixture = lessonFixture(storage)
  // When / Then
  expect(() => generateFixtureLesson(storage, fixture.request, fixture.draft)).toThrow(
    "current-outline-required",
  )
  expect(storage.counts().lessons).toBe(0)
})

it.each([
  "stale",
  "missing-ja",
  "foreign-source",
  "missing-caveat",
  "missing-assumptions",
  "missing-section",
  "missing-scene-note",
  "missing-rationale",
])("rejects %s fixture output before writing a lesson", (fault) => {
  // Given
  const fixture = lessonFixture(storage)
  storage.outlines.decide({ studyId: "study-1", revisionId: fixture.outline.id, action: "approve" })
  const draft = structuredClone(fixture.draft)
  const section = draft.sections[0]
  if (!section) throw new TypeError("fixture section required")
  switch (fault) {
    case "stale":
      draft.outlineRevisionId = OutlineRevisionId.parse("old-outline")
      break
    case "missing-ja":
      section.content.ja = ""
      break
    case "foreign-source":
      section.attribution.sources[0] = { ...fixture.span, blockId: "foreign" }
      break
    case "missing-caveat":
      section.caveats = []
      break
    case "missing-assumptions":
      section.sceneNotes[0]?.assumptions.splice(0)
      break
    case "missing-section":
      draft.sections = []
      break
    case "missing-scene-note":
      section.sceneNotes = []
      break
    case "missing-rationale": {
      const option = section.practice[0]?.options[0]
      if (option) option.feedback.ja = ""
      break
    }
  }
  // When / Then
  expect(() => generateFixtureLesson(storage, fixture.request, draft)).toThrow()
  expect(storage.counts().lessons).toBe(0)
})

it("rejects an old approval when a replacement outline exists", () => {
  // Given
  const fixture = lessonFixture(storage)
  storage.outlines.decide({ studyId: "study-1", revisionId: fixture.outline.id, action: "approve" })
  const { id, ...previous } = fixture.outline
  storage.outlines.save({ ...previous, expectedRevisionId: id })
  // When / Then
  expect(() => generateFixtureLesson(storage, fixture.request, fixture.draft)).toThrow()
})
