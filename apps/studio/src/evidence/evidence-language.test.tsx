// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { LanguageProvider } from "../i18n/LanguageProvider.tsx"
import { LANGUAGE_STORAGE_KEY } from "../i18n/preference.ts"
import { EvidenceRoutes } from "./EvidenceRoutes.tsx"

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
})

it("localizes evidence controls and reader language without changing projected text", async () => {
  // Given
  history.replaceState(null, "", "/evidence/study-1/lesson-1")
  localStorage.setItem(LANGUAGE_STORAGE_KEY, "ja")
  const request = vi.fn(async () =>
    Response.json({
      view: {
        draft: {
          id: "draft-1",
          studyId: "study-1",
          lessonRevisionId: "lesson-1",
          projectionHash: "hash-1",
          keepPrivate: false,
          semantic: [{ category: "support", status: "unresolved" }],
        },
        mechanical: [],
        privacy: { id: "privacy-1", status: "pending", reviewedPaths: [], findings: [] },
        ready: false,
        reportHash: "report-1",
      },
      references: [],
      entries: [{ path: "/title/en", text: "Projected original" }],
      removable: [],
    }),
  )
  vi.stubGlobal("fetch", request)
  // When
  render(
    <LanguageProvider>
      <EvidenceRoutes />
    </LanguageProvider>,
  )
  // Then
  expect(await screen.findByRole("heading", { name: "根拠とプライバシー" })).toBeDefined()
  expect(screen.getByRole("button", { name: "非公開のままにする" })).toBeDefined()
  expect(screen.getByRole("heading", { name: "主張の裏付け" })).toBeDefined()
  expect(screen.getByText("Projected original", { selector: "p" })).toBeDefined()
  expect(screen.getByRole("link", { name: "対訳で本文を読む" }).getAttribute("href")).toBe(
    "/api/evidence/study-1/lesson-1/read?lang=ja",
  )
  expect(request).toHaveBeenCalledTimes(1)
})

it("shows the Japanese stale-lesson warning when evidence is unavailable", async () => {
  // Given
  history.replaceState(null, "", "/evidence/study-1/lesson-1")
  localStorage.setItem(LANGUAGE_STORAGE_KEY, "ja")
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 404 })),
  )
  // When
  render(
    <LanguageProvider>
      <EvidenceRoutes />
    </LanguageProvider>,
  )
  // Then
  expect((await screen.findByRole("alert")).textContent).toBe(
    "この教材は古い版か利用できません。現在の承認済み構成と教材を確認してください。",
  )
})
