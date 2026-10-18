// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { LanguageProvider } from "../i18n/LanguageProvider.tsx"
import { LANGUAGE_STORAGE_KEY } from "../i18n/preference.ts"
import { OutlineRoutes } from "./OutlineRoutes.tsx"

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
})

it("renders Japanese outline controls while keeping generated titles unchanged", async () => {
  // Given
  history.replaceState(null, "", "/outlines/study-1")
  localStorage.setItem(LANGUAGE_STORAGE_KEY, "ja")
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        view: {
          status: "pending",
          draft: {
            id: "outline-1",
            feedback: null,
            content: {
              title: { en: "Generated title", ja: "生成済みの題名" },
              theme: { en: "Theme content", ja: "主題の内容" },
              sections: [],
              qualifications: [],
              excludedAreas: [],
            },
          },
        },
        brief: null,
        scope: null,
        fixture: true,
        providerReady: false,
      }),
    ),
  )
  // When
  render(
    <LanguageProvider>
      <OutlineRoutes />
    </LanguageProvider>,
  )
  // Then
  expect(await screen.findByRole("heading", { name: "学習の構成" })).toBeDefined()
  expect(screen.getByRole("button", { name: "構成を承認" })).toBeDefined()
  expect(screen.getByRole("button", { name: "選んだ修正を適用" })).toBeDefined()
  expect(screen.getByRole("heading", { name: "Generated title" })).toBeDefined()
  expect(screen.getByText("生成済みの題名")).toBeDefined()
  expect(screen.getByRole("heading", { name: "学ぶ順序" })).toBeDefined()
})

it("renders the Japanese missing-study alert on request failure", async () => {
  // Given
  history.replaceState(null, "", "/outlines/study-1")
  localStorage.setItem(LANGUAGE_STORAGE_KEY, "ja")
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 404 })),
  )
  // When
  render(
    <LanguageProvider>
      <OutlineRoutes />
    </LanguageProvider>,
  )
  // Then
  expect((await screen.findByRole("alert")).textContent).toBe("読書が見つかりません")
})
