// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { LanguageProvider } from "../i18n/LanguageProvider.tsx"
import { LANGUAGE_STORAGE_KEY } from "../i18n/preference.ts"
import { PublicationRoutes } from "./PublicationRoutes.tsx"

const state = {
  view: {
    draft: {
      id: "draft-1",
      studyId: "study-1",
      lessonRevisionId: "lesson-1",
      projectionHash: "hash-1",
      keepPrivate: false,
      projection: { title: { en: "Original title", ja: "元の題名" }, sections: [] },
    },
    reportHash: "report-1",
    ready: true,
    privacy: { id: "privacy-1" },
  },
  entries: [],
  history: [],
}

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
})

it("keeps export controls English by default even when app chrome is Japanese", async () => {
  // Given
  history.replaceState(null, "", "/publications/study-1")
  localStorage.setItem(LANGUAGE_STORAGE_KEY, "ja")
  const request = vi.fn(async () => Response.json(state))
  vi.stubGlobal("fetch", request)
  // When
  render(
    <LanguageProvider>
      <PublicationRoutes />
    </LanguageProvider>,
  )
  // Then
  expect(await screen.findByRole("heading", { name: "公開用ファイル" })).toBeDefined()
  expect(screen.getByRole("combobox", { name: "出力ファイルの表示言語" })).toHaveProperty(
    "value",
    "en",
  )
  expect(screen.getByText("Original title", { exact: false })).toBeDefined()
  expect(screen.getByText("元の題名")).toBeDefined()
  expect(request).toHaveBeenCalledTimes(1)
})

it("captures the explicitly selected export language when Publish is chosen", async () => {
  // Given
  history.replaceState(null, "", "/publications/study-1")
  localStorage.setItem(LANGUAGE_STORAGE_KEY, "ja")
  const request = vi.fn(async () => Response.json(state))
  vi.stubGlobal("fetch", request)
  render(
    <LanguageProvider>
      <PublicationRoutes />
    </LanguageProvider>,
  )
  const choice = await screen.findByRole("combobox", { name: "出力ファイルの表示言語" })
  fireEvent.change(choice, { target: { value: "en+ja" } })
  // When
  fireEvent.click(screen.getByRole("button", { name: "公開用に承認" }))
  // Then
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2))
  expect(request).toHaveBeenLastCalledWith(
    "/api/publications/study-1",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ expectedId: "draft-1", action: "publish", exportUi: "en+ja" }),
    }),
  )
})

it("shows the immutable approved export choice rather than a fresh form default", async () => {
  // Given
  history.replaceState(null, "", "/publications/study-1")
  localStorage.setItem(LANGUAGE_STORAGE_KEY, "en")
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        ...state,
        history: [
          {
            current: true,
            snapshot: {
              publication: {
                id: "publication-1",
                approval: { rendererVersion: "fixture", approvedAt: "2026-10-18T00:00:00Z" },
              },
              evidence: { draft: { studyId: "study-1" } },
            },
            outputs: ["html", "pdf"].map((format) => ({
              id: `job-${format}`,
              format,
              state: "queued",
              exportUi: "ja",
            })),
          },
        ],
      }),
    ),
  )
  // When
  render(
    <LanguageProvider>
      <PublicationRoutes />
    </LanguageProvider>,
  )
  // Then
  const choice = await screen.findByRole("combobox", { name: "Export interface language" })
  expect(choice).toHaveProperty("value", "ja")
  expect(choice).toHaveProperty("disabled", true)
  expect(screen.getAllByText("Queued — not available")).toHaveLength(2)
})
