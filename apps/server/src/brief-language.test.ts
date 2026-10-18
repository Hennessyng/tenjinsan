import { publicationFixture } from "@reading-studio/server/publication-fixture"
import { briefPage } from "@reading-studio/studio/brief"
import { expect, it } from "vitest"

it("renders server brief chrome in Japanese without translating saved questions", async () => {
  // Given
  const fixture = await publicationFixture()
  try {
    const studyId = fixture.lesson.studyId
    const setup = fixture.storage.sources.getLatestSetup(studyId)
    const view = fixture.storage.briefs.current(studyId)
    if (!setup || !view) throw new TypeError("Missing fixture brief")
    // When
    const result = String(
      await briefPage({ setup, view, edit: false, error: false, descendants: [], locale: "ja" }),
    )
    // Then
    expect(result).toContain("<h1>読書方針</h1>")
    expect(result).toContain('lang="ja"')
    expect(result).toContain("How can attention help?")
    expect(result).toContain("注意はどう役立つか？")
    expect(result).not.toContain("Review saved answers")
  } finally {
    await fixture.close()
  }
})
