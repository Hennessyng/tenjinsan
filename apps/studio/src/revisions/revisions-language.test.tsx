// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { LanguageProvider } from "../i18n/LanguageProvider.tsx"
import { LANGUAGE_STORAGE_KEY } from "../i18n/preference.ts"
import { RevisionRoutes } from "./RevisionRoutes.tsx"

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
})

it("renders Japanese revision decisions without submitting them on display", async () => {
  // Given
  history.replaceState(null, "", "/revisions/study-1")
  localStorage.setItem(LANGUAGE_STORAGE_KEY, "ja")
  const request = vi.fn(async () =>
    Response.json({
      view: {
        setup: {
          id: "setup-1",
          studyId: "study-1",
          editionId: "edition-1",
          analysis: {
            provider: "anthropic",
            model: "synthetic-model",
            scope: { kind: "partial", selected: [], exclusions: [] },
          },
        },
        history: [],
        parent: null,
        analysis: null,
        grant: null,
      },
      available: false,
      canEdit: true,
      choices: [],
    }),
  )
  vi.stubGlobal("fetch", request)
  // When
  render(
    <LanguageProvider>
      <RevisionRoutes />
    </LanguageProvider>,
  )
  // Then
  expect(await screen.findByRole("heading", { name: "読書の版" })).toBeDefined()
  expect(screen.getByRole("button", { name: "別の視点に分岐" })).toBeDefined()
  expect(screen.getByRole("heading", { name: "設定の履歴" })).toBeDefined()
  expect(screen.getByRole("button", { name: "送信を許可" })).toHaveProperty("disabled", true)
  expect(screen.getByText("setup-1")).toBeDefined()
  expect(screen.getByText("一部のみ")).toBeDefined()
  expect(request).toHaveBeenCalledTimes(1)
  expect(document.body.textContent).not.toContain("Fresh consent required")
})

it("renders a Japanese recovery link when the revision is unavailable", async () => {
  // Given
  history.replaceState(null, "", "/revisions/study-1")
  localStorage.setItem(LANGUAGE_STORAGE_KEY, "ja")
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 404 })),
  )
  // When
  render(
    <LanguageProvider>
      <RevisionRoutes />
    </LanguageProvider>,
  )
  // Then
  expect(await screen.findByRole("heading", { name: "読書が見つかりません" })).toBeDefined()
  expect(screen.getByRole("link", { name: "質問に戻る" })).toBeDefined()
})
