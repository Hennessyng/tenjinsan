import { publicationFixture } from "@reading-studio/server/publication-fixture"
import { revisionPage } from "@reading-studio/studio/revisions"
import { expect, it } from "vitest"

it("renders Japanese revision forms with immutable setup identifiers preserved", async () => {
  // Given
  const fixture = await publicationFixture()
  try {
    const study = fixture.storage.sources
      .listStudiesByEdition("edition-fixture")
      .find((item) => item.id === fixture.lesson.studyId)
    if (!study) throw new TypeError("Missing fixture study")
    const view = fixture.storage.revisions.current({ studyId: study.id, ownerId: study.ownerId })
    // When
    const result = String(
      await revisionPage(view, {
        available: false,
        canEdit: true,
        error: true,
        choices: [],
        locale: "ja",
      }),
    )
    // Then
    expect(result).toContain("<h1>読書の版</h1>")
    expect(result).toContain('value="fork">別の視点に分岐')
    expect(result).toContain(`value="${view.setup.id}"`)
    expect(result).not.toContain("Fresh provider consent")
    expect(result).toContain("<p>一部のみ</p>")
  } finally {
    await fixture.close()
  }
})
