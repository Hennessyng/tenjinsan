import { sourceViewerFixture } from "@reading-studio/server/source-viewer-fixture"
import { expect, it } from "vitest"

it("accepts UI language alongside a chapter without invalidating source API queries", async () => {
  // Given
  const fixture = await sourceViewerFixture()
  try {
    // When
    const api = await fetch(
      `${fixture.origin}/api/source-reader/revision-fixture?chapter=0&lang=ja`,
    )
    const page = await fetch(`${fixture.origin}/sources/revision-fixture?chapter=0&lang=ja`)
    // Then
    expect(api.status).toBe(200)
    expect(page.status).toBe(200)
    expect(await page.text()).toContain("<h2>目次</h2>")
  } finally {
    await fixture.close()
  }
})

it("ignores unsupported UI language without dropping the valid source chapter", async () => {
  // Given
  const fixture = await sourceViewerFixture()
  try {
    // When
    const page = await fetch(`${fixture.origin}/sources/revision-fixture?chapter=0&lang=fr`)
    // Then
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('<html lang="en">')
  } finally {
    await fixture.close()
  }
})
