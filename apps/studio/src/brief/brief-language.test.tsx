// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { LanguageProvider } from "../i18n/LanguageProvider.tsx"
import { LANGUAGE_STORAGE_KEY } from "../i18n/preference.ts"
import { BriefEditor } from "./BriefEditor.tsx"
import { BriefRoutes } from "./BriefRoutes.tsx"
import type { Brief } from "./client.ts"

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
})

it("localizes new-brief fields without changing the requested lesson-language default", () => {
  // Given
  history.replaceState(null, "", "/briefs/study-synthetic")
  localStorage.setItem(LANGUAGE_STORAGE_KEY, "ja")
  const save = vi.fn()
  // When
  render(
    <LanguageProvider>
      <BriefEditor view={null} onSave={save} busy={false} />
    </LanguageProvider>,
  )
  // Then
  expect(screen.getByRole("button", { name: "内容を確認" })).toBeDefined()
  expect(screen.getByRole("textbox", { name: "最初の問い（英語）" })).toBeDefined()
  expect(screen.getByRole("combobox", { name: "言語" }).getAttribute("name")).toBe("language")
  expect(screen.getByRole("combobox", { name: "言語" })).toHaveProperty("value", "paired")
  expect(save).not.toHaveBeenCalled()
})

it("shows Japanese approved-brief controls while preserving both saved questions", async () => {
  // Given
  history.replaceState(null, "", "/briefs/study-synthetic")
  localStorage.setItem(LANGUAGE_STORAGE_KEY, "ja")
  const scope: Brief["setup"]["analysis"]["scope"] = {
    kind: "partial",
    selected: [],
    exclusions: [],
  }
  const response: Brief = {
    setup: { studyId: "study-synthetic", analysis: { scope } },
    descendants: [],
    view: {
      status: "approved",
      draft: {
        id: "brief-synthetic",
        scope,
        content: {
          originalQuestion: { en: "Saved English question?", ja: "保存済みの日本語の問い？" },
          refinedQuestion: null,
          questionChoice: "original",
          supportingQuestions: [],
          purpose: "Saved purpose",
          context: "Saved context",
          depth: "focused",
          language: "paired",
          spoilerPolicy: "avoid",
          exclusions: [],
        },
      },
    },
  }
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(response)),
  )
  // When
  render(
    <LanguageProvider>
      <BriefRoutes />
    </LanguageProvider>,
  )
  // Then
  expect(await screen.findByRole("heading", { name: "読書方針" })).toBeDefined()
  expect(screen.getByRole("status").textContent).toBe("読書方針を承認しました")
  expect(screen.getByRole("button", { name: "修正する" })).toBeDefined()
  expect(screen.getByRole("button", { name: "保留する" })).toBeDefined()
  expect(screen.getByRole("heading", { name: "主となる問い" })).toBeDefined()
  expect(screen.getByText("Saved English question?", { selector: "p" })).toBeDefined()
  expect(screen.getByText("保存済みの日本語の問い？", { selector: "p" })).toBeDefined()
})

it.each([
  ["en", "Brief unavailable", "Return to interviews"],
  ["ja", "読書方針は未準備です", "質問に戻る"],
] as const)(
  "shows localized recovery when the brief request fails in %s",
  async (locale, title, link) => {
    // Given
    history.replaceState(null, "", "/briefs/study-synthetic")
    localStorage.setItem(LANGUAGE_STORAGE_KEY, locale)
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 404 })),
    )
    // When
    render(
      <LanguageProvider>
        <BriefRoutes />
      </LanguageProvider>,
    )
    // Then
    expect(await screen.findByRole("heading", { name: title })).toBeDefined()
    expect(screen.getByRole("link", { name: link })).toBeDefined()
  },
)
