import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { generateFixtureLesson, LessonGenerationError } from "@reading-studio/generation/lesson"
import { openStorage } from "@reading-studio/storage"
import { lessonFixture } from "../tests/lesson-fixture.ts"

const directory = mkdtempSync(join(tmpdir(), "lesson-cli-"))
const storage = openStorage({ databasePath: join(directory, "db"), privateDataRoot: directory })
try {
  const fixture = lessonFixture(storage)
  let pendingRejected = false
  try {
    generateFixtureLesson(storage, fixture.request, fixture.draft)
  } catch (error) {
    if (!(error instanceof LessonGenerationError) || error.code !== "current-outline-required")
      throw error
    pendingRejected = true
  }
  if (!pendingRejected) throw new TypeError("Pending outline generated a lesson")
  storage.outlines.decide({ studyId: "study-1", revisionId: fixture.outline.id, action: "approve" })
  const result = generateFixtureLesson(storage, fixture.request, fixture.draft)
  process.stdout.write(`${JSON.stringify({ pendingRejected, ...result }, null, 2)}\n`)
} finally {
  storage.close()
  rmSync(directory, { recursive: true, force: true })
}
