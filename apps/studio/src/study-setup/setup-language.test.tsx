// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { LanguageProvider } from "../i18n/LanguageProvider.tsx"
import { LANGUAGE_STORAGE_KEY } from "../i18n/preference.ts"
import { PreparationRefusal } from "./PreparationRefusal.tsx"
import { SetupRoutes } from "./SetupRoutes.tsx"

const normalization = {
  id: "revision-1",
  editionId: "edition-1",
  editionHash: "a".repeat(64),
  parserVersion: "2",
  normalizerVersion: "2",
  coverage: "complete",
  resources: [
    {
      path: "source.txt",
      role: "main-chapter",
      status: "included",
      blocks: [{ id: "block-1", text: "Saved original text" }],
    },
  ],
}
afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
})

it.each([
  ["analysis-window-limit", "分析範囲の上限に達しました"],
  ["empty-text-scope", "選んだ範囲に本文がありません"],
] as const)(
  "localizes preparation reason %s while retaining its diagnostic code",
  (reason, label) => {
    // Given
    history.replaceState(null, "", "/sources/revision-1/setup")
    localStorage.setItem(LANGUAGE_STORAGE_KEY, "ja")
    // When
    render(
      <LanguageProvider>
        <PreparationRefusal
          failure={{
            error: "scope-limit",
            coverage: {
              transmission: "not-sent",
              reason,
              requiredWindows: 129,
              maxWindows: 128,
              unsentRanges: [],
            },
          }}
        />
      </LanguageProvider>,
    )
    // Then
    expect(screen.getByRole("alert").textContent).toContain(label)
    expect(screen.getByText(reason, { selector: "code" })).toBeDefined()
  },
)

it("localizes setup and connection controls without sending or connecting on display", async () => {
  // Given
  history.replaceState(null, "", "/sources/revision-1/setup")
  localStorage.setItem(LANGUAGE_STORAGE_KEY, "ja")
  const request = vi.fn(async () =>
    Response.json({
      normalization,
      choices: [{ provider: "anthropic", model: "synthetic", label: "Anthropic synthetic" }],
    }),
  )
  vi.stubGlobal("fetch", request)
  // When
  render(
    <LanguageProvider>
      <SetupRoutes />
    </LanguageProvider>,
  )
  // Then
  expect(await screen.findByRole("heading", { name: "読書を設定する" })).toBeDefined()
  expect(screen.getByRole("button", { name: "送信内容を確認" })).toBeDefined()
  expect(screen.getByRole("button", { name: "Codex に接続" })).toBeDefined()
  expect(
    screen.getByRole("radio", { name: "文書全体 — 補足部分を含む抽出済みテキストすべて" }),
  ).toHaveProperty("checked", true)
  expect(request).toHaveBeenCalledTimes(1)
})

it("localizes unavailable-provider review without enabling Send", async () => {
  // Given
  history.replaceState(null, "", "/sources/revision-1/setup/setup-1")
  localStorage.setItem(LANGUAGE_STORAGE_KEY, "ja")
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        normalization,
        available: false,
        setup: {
          id: "setup-1",
          analysis: {
            provider: "anthropic",
            model: "synthetic",
            normalizationRevisionId: "revision-1",
            scope: {
              kind: "whole-document",
              selected: [{ resourcePath: "source.txt", blockIds: ["block-1"] }],
            },
          },
        },
      }),
    ),
  )
  // When
  render(
    <LanguageProvider>
      <SetupRoutes />
    </LanguageProvider>,
  )
  // Then
  expect(await screen.findByRole("heading", { name: "送信内容を確認" })).toBeDefined()
  expect(screen.getByRole("button", { name: "送信" })).toHaveProperty("disabled", true)
  expect(screen.getByText("設定の版：setup-1")).toBeDefined()
})

it("localizes setup-unavailable recovery", async () => {
  // Given
  history.replaceState(null, "", "/sources/revision-1/setup")
  localStorage.setItem(LANGUAGE_STORAGE_KEY, "ja")
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 404 })),
  )
  // When
  render(
    <LanguageProvider>
      <SetupRoutes />
    </LanguageProvider>,
  )
  // Then
  expect(await screen.findByRole("heading", { name: "設定を利用できません" })).toBeDefined()
  expect(screen.getByRole("link", { name: "設定に戻る" })).toBeDefined()
})
