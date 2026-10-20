// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { LanguageProvider } from "../i18n/LanguageProvider.tsx"
import { SetupRoutes } from "./SetupRoutes.tsx"

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
})

it.each([
  [503, "Selected provider unavailable", /selected provider is unavailable/i],
  [409, "subscription-connection-changed", /connection changed since review/i],
] as const)(
  "explains refused Send (%s) and offers connection/setup review",
  async (status, error, reason) => {
    // Given
    window.history.replaceState(null, "", "/sources/source-23/setup/setup-23?lang=en")
    const request = vi.fn(async (_path: string, options?: RequestInit) =>
      options?.method === "POST"
        ? Response.json({ error }, { status })
        : Response.json({
            setup: {
              id: "setup-23",
              analysis: {
                provider: "anthropic",
                model: "fixture",
                normalizationRevisionId: "source-23",
                scope: {
                  kind: "whole-document",
                  selected: [{ resourcePath: "document.txt", blockIds: ["block"] }],
                },
              },
            },
            normalization: {
              id: "source-23",
              editionId: "edition-23",
              editionHash: "a".repeat(64),
              parserVersion: "1",
              normalizerVersion: "1",
              coverage: "complete",
              resources: [
                {
                  path: "document.txt",
                  role: "main-chapter",
                  status: "included",
                  blocks: [{ id: "block", text: "Synthetic source" }],
                },
              ],
            },
            available: true,
          }),
    )
    vi.stubGlobal("fetch", request)
    render(
      <LanguageProvider>
        <SetupRoutes />
      </LanguageProvider>,
    )
    // When
    fireEvent.click(await screen.findByRole("button", { name: "Send" }))
    // Then
    expect((await screen.findByRole("alert")).textContent).toMatch(reason)
    expect(
      screen
        .getByRole("link", { name: "Check connections and review a new setup" })
        .getAttribute("href"),
    ).toBe("/sources/source-23/setup?lang=en")
    expect(screen.queryByRole("heading", { name: "Transmission approved" })).toBeNull()
    expect(request.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1)
  },
)
