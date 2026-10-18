import { publicationFixture } from "@reading-studio/server/publication-fixture"
import { expect, it } from "vitest"

it.each(["en", "ja", "en+ja", undefined] as const)(
  "fixes both job choices when Publish accepts %s",
  async (choice) => {
    // Given
    const fixture = await publicationFixture()
    try {
      // When
      const response = await fetch(`${fixture.origin}/api/publications/${fixture.lesson.studyId}`, {
        method: "POST",
        headers: { origin: fixture.origin, "content-type": "application/json" },
        body: JSON.stringify({
          expectedId: fixture.view.draft.id,
          action: "publish",
          ...(choice === undefined ? {} : { exportUi: choice }),
        }),
      })
      // Then
      expect(response.status).toBe(200)
      const [snapshot] = fixture.storage.publicationOutputs.list(fixture.lesson.studyId)
      if (!snapshot) throw new TypeError("Missing approved snapshot")
      expect(
        fixture.storage.publicationOutputs
          .outputs(snapshot.publication.id)
          .map((output) => output.exportUi),
      ).toEqual([choice ?? "en", choice ?? "en"])
    } finally {
      await fixture.close()
    }
  },
)

it("rejects an unsupported export language without approving a publication", async () => {
  // Given
  const fixture = await publicationFixture()
  try {
    // When
    const response = await fetch(`${fixture.origin}/api/publications/${fixture.lesson.studyId}`, {
      method: "POST",
      headers: { origin: fixture.origin, "content-type": "application/json" },
      body: JSON.stringify({
        expectedId: fixture.view.draft.id,
        action: "publish",
        exportUi: "fr",
      }),
    })
    // Then
    expect(response.status).toBe(422)
    expect(fixture.storage.publicationOutputs.list(fixture.lesson.studyId)).toEqual([])
  } finally {
    await fixture.close()
  }
})
