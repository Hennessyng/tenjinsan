// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { LanguageProvider } from "../i18n/LanguageProvider.tsx"
import { SetupRoutes } from "./SetupRoutes.tsx"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
it("shows a safe preparation limit and every unsent range without claiming consent was saved", async () => {
  // Given
  window.history.replaceState(null, "", "/sources/revision-fixture/setup/setup-fixture")
  const review = {
    setup: {
      id: "setup-fixture",
      analysis: {
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        normalizationRevisionId: "revision-fixture",
        scope: {
          kind: "whole-document",
          selected: [{ resourcePath: "document.txt", blockIds: ["block-fixture"] }],
        },
      },
    },
    normalization: {
      id: "revision-fixture",
      editionId: "edition-fixture",
      editionHash: "a".repeat(64),
      parserVersion: "2",
      normalizerVersion: "2",
      coverage: "complete",
      resources: [
        {
          path: "document.txt",
          role: "main-chapter",
          status: "included",
          blocks: [{ id: "block-fixture", text: "Synthetic text" }],
        },
      ],
    },
    available: true,
  }
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_path: string, options?: RequestInit) =>
      options?.method === "POST"
        ? Response.json(
            {
              error: "scope-limit",
              coverage: {
                transmission: "not-sent",
                reason: "analysis-window-limit",
                requiredWindows: 129,
                maxWindows: 128,
                unsentRanges: [
                  {
                    resourcePath: "document.txt",
                    blockId: "block-fixture",
                    start: 0,
                    end: 12,
                    locator: { kind: "txt", start: 0, startLine: 1 },
                  },
                ],
              },
            },
            { status: 422 },
          )
        : Response.json(review),
    ),
  )
  render(
    <LanguageProvider>
      <SetupRoutes />
    </LanguageProvider>,
  )
  // When
  fireEvent.click(await screen.findByRole("button", { name: "Send" }))
  // Then
  const alert = await screen.findByRole("alert")
  expect(alert.textContent).toContain("analysis-window-limit")
  expect(alert.textContent).toContain("document.txt")
  expect(alert.textContent).toContain("[0, 12)")
  expect(alert.textContent).toContain("No grant")
  expect(screen.queryByText(/Consent saved/)).toBeNull()
  expect(screen.getByRole("button", { name: "Send" }).hasAttribute("disabled")).toBe(false)
})
