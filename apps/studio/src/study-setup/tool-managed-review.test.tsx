// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { LanguageProvider } from "../i18n/LanguageProvider.tsx"
import { SetupReview as ReviewSchema } from "./client.ts"
import { SetupReview } from "./SetupReview.tsx"

afterEach(cleanup)
it.each(["chatgpt-subscription", "grok-subscription"])(
  "discloses tool-managed request scope before enabling %s Send",
  (provider) => {
    // Given
    const value = ReviewSchema.parse({
      setup: {
        id: "review",
        analysis: {
          provider,
          model: "study-model",
          normalizationRevisionId: "source",
          scope: {
            kind: "whole-document",
            selected: [{ resourcePath: "source.txt", blockIds: ["block"] }],
          },
        },
      },
      normalization: {
        id: "source",
        editionId: "edition",
        editionHash: "a".repeat(64),
        parserVersion: "1",
        normalizerVersion: "1",
        coverage: "complete",
        resources: [
          {
            path: "source.txt",
            role: "main-chapter",
            status: "included",
            blocks: [{ id: "block", text: "Synthetic source" }],
          },
        ],
      },
      available: true,
    })
    // When
    render(
      <LanguageProvider>
        <SetupReview value={value} onDecision={vi.fn()} busy={false} />
      </LanguageProvider>,
    )
    // Then
    expect(screen.getByRole("region", { name: "Tool-managed execution" })).toBeDefined()
    expect(screen.getByRole("button", { name: "Send" })).toHaveProperty("disabled", false)
  },
)
