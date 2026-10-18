import { interviewFixture } from "@reading-studio/server/interview-fixture"
import { interviewPage } from "@reading-studio/studio/interview"
import { expect, it } from "vitest"

it("uses Japanese server interview chrome and language-preserving ordinary links", async () => {
  // Given
  const fixture = await interviewFixture()
  try {
    // When
    const result = String(
      await interviewPage({
        definition: fixture.definition,
        answers: [],
        stepId: undefined,
        language: "ja",
        state: "view",
      }),
    )
    // Then
    expect(result).toContain('aria-label="質問の移動"')
    expect(result).toContain(`href="/briefs/${fixture.definition.studyId}?lang=ja"`)
    expect(result).not.toContain("Reading brief /")
    expect(result).not.toContain('<span lang="en">READING</span>')
  } finally {
    await fixture.close()
  }
})

it("localizes the interview list and missing-interview recovery routes", async () => {
  // Given
  const fixture = await interviewFixture()
  try {
    // When
    const list = await fetch(`${fixture.origin}/interviews?lang=ja`)
    const missing = await fetch(`${fixture.origin}/interviews/missing-study?lang=ja`)
    // Then
    expect(await list.text()).toContain("<h1>読書の質問</h1>")
    expect(missing.status).toBe(404)
    expect(await missing.text()).toContain("<h1>質問は未準備です</h1>")
  } finally {
    await fixture.close()
  }
})
