// @vitest-environment happy-dom
import type { ExportUi } from "@reading-studio/contracts"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { LanguageProvider } from "../i18n/LanguageProvider.tsx"
import { LANGUAGE_STORAGE_KEY } from "../i18n/preference.ts"
import type { Publication } from "./client.ts"
import { PublicationHistory } from "./PublicationHistory.tsx"

afterEach(() => {
  cleanup()
  localStorage.clear()
})

it("shows each past edition's captured interface language without inventing a legacy default", () => {
  // Given
  history.replaceState(null, "", "/publications/study-1")
  localStorage.setItem(LANGUAGE_STORAGE_KEY, "en")
  const modes: readonly (ExportUi | undefined)[] = ["en", "ja", "en+ja", undefined]
  const value: Publication = {
    view: null,
    entries: [],
    history: modes.map((exportUi, index) => ({
      current: false,
      snapshot: {
        ...(exportUi ? { exportUi } : {}),
        publication: {
          id: `p-${index}`,
          approval: { rendererVersion: "fixture", approvedAt: "2026-10-18T00:00:00Z" },
        },
        evidence: { draft: { studyId: "study-1" } },
      },
      outputs: [],
    })),
  }
  const generate = vi.fn()
  // When
  render(
    <LanguageProvider>
      <PublicationHistory value={value} busy={false} onGenerate={generate} />
    </LanguageProvider>,
  )
  // Then
  for (const language of ["English", "Japanese", "English + Japanese", "Not recorded (legacy)"])
    expect(screen.getByText(`File interface: ${language}`)).toBeDefined()
  expect(generate).not.toHaveBeenCalled()
})
