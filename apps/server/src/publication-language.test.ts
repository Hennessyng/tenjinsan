import { publicationFixture } from "@reading-studio/server/publication-fixture"
import { publicationPage } from "@reading-studio/studio/publication"
import { expect, it } from "vitest"
import { approvePublication } from "./publication-service.ts"

it("renders Japanese server publication controls with independent English-default exports", async () => {
  // Given
  const fixture = await publicationFixture()
  try {
    // When
    const result = String(await publicationPage(fixture.view, [], "ja"))
    // Then
    expect(result).toContain("<h1>公開用ファイル</h1>")
    expect(result).toContain('name="exportUi"')
    expect(result).toContain('value="en" selected')
    expect(result).toContain('value="publish" >公開用に承認')
    expect(result).toContain(fixture.view.draft.projection.title.en)
    expect(result).not.toContain("Cleaned publication")
  } finally {
    await fixture.close()
  }
})

it("shows captured paired interface language on a past server-rendered edition", async () => {
  // Given
  const fixture = await publicationFixture()
  try {
    const snapshot = approvePublication(fixture.storage, fixture.view, "en+ja")
    // When
    const result = String(
      await publicationPage(
        fixture.view,
        [
          {
            snapshot,
            current: false,
            outputs: fixture.storage.publicationOutputs.outputs(snapshot.publication.id),
          },
        ],
        "ja",
      ),
    )
    // Then
    expect(result).toContain("ファイルの表示言語：英語 ＋ 日本語")
  } finally {
    await fixture.close()
  }
})
