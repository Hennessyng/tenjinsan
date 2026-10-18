import { expect, it } from "vitest"
import { outlinePage } from "./page.ts"

it("renders Japanese blocked-generation notices in the server outline page", async () => {
  // Given
  const input = {
    view: null,
    brief: null,
    scope: null,
    studyId: "study-1",
    fixture: false,
    error: true,
    locale: "ja",
  } as const
  // When
  const result = String(await outlinePage(input))
  // Then
  expect(result).toContain("<h1>学習の構成</h1>")
  expect(result).toContain("構成を生成する前に、現在の読書方針を承認してください。")
  expect(result).not.toContain("Live generation blocked")
  expect(result).toContain('href="/briefs/study-1?lang=ja"')
})
