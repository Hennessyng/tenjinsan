import { publicationFixture } from "@reading-studio/server/publication-fixture"
import { evidencePage, evidencePreview } from "@reading-studio/studio/evidence"
import { expect, it } from "vitest"

it("renders Japanese server evidence controls while preserving the approved projection", async () => {
  // Given
  const fixture = await publicationFixture()
  try {
    const title = fixture.view.draft.projection.title.en
    // When
    const result = String(await evidencePage(fixture.view, false, { references: [], locale: "ja" }))
    // Then
    expect(result).toContain("<h1>根拠とプライバシー</h1>")
    expect(result).toContain('value="keep-private">非公開のままにする')
    expect(result).toContain(title)
    expect(result).toContain("/read?lang=ja")
    expect(result).not.toContain("Mark support reviewed")
  } finally {
    await fixture.close()
  }
})

it("localizes preview chrome while keeping projection text and no-script boundaries", async () => {
  // Given
  const fixture = await publicationFixture()
  try {
    // When
    const result = String(await evidencePreview(fixture.view, "ja"))
    // Then
    expect(result).toContain("<h1>公開用データの確認</h1>")
    expect(result).toContain(fixture.view.draft.projection.title.en)
    expect(result).not.toContain("<script")
    expect(result).not.toContain("Asset description:")
  } finally {
    await fixture.close()
  }
})
