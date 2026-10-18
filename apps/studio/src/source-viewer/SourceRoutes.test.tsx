// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { LanguageProvider } from "../i18n/LanguageProvider.tsx"
import { SourceRoutes } from "./SourceRoutes.tsx"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
it("shows included-part omissions and real page locations when a partial PDF is read", async () => {
  // Given
  window.history.replaceState(null, "", "/sources/revision-synthetic")
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        edition: {
          id: "edition-synthetic",
          title: "Synthetic",
          originalHash: "a".repeat(64),
          originalBlobHash: "a".repeat(64),
          format: "pdf",
        },
        normalization: {
          id: "revision-synthetic",
          editionId: "edition-synthetic",
          editionHash: "a".repeat(64),
          parserVersion: "pdf-2",
          normalizerVersion: "2",
          coverage: "partial",
          omissions: [{ path: "pdf/page-2", reason: "no-selectable-text" }],
          resources: [
            {
              path: "pdf/page-1",
              role: "main-chapter",
              status: "included",
              blocks: [
                {
                  id: "block-synthetic",
                  text: "Selectable text",
                  locator: { kind: "pdf", page: 1 },
                },
              ],
            },
          ],
        },
        chapter: 0,
        span: null,
      }),
    ),
  )
  // When
  render(
    <LanguageProvider>
      <SourceRoutes />
    </LanguageProvider>,
  )
  // Then
  expect(await screen.findByText(/PDF page 1/)).toBeDefined()
  expect(screen.getByText(/no-selectable-text/)).toBeDefined()
})
