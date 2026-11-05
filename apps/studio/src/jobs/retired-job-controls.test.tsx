// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { LanguageProvider } from "../i18n/LanguageProvider.tsx"
import { JobRoutes } from "./JobRoutes.tsx"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it("does not offer a paid retry for a retired unknown-outcome job", async () => {
  // Given
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        providerCharges: "not-returned",
        jobs: [
          {
            id: "synthetic-job",
            studyId: "synthetic-study",
            sourceRevisionId: "synthetic-source",
            setupRevisionId: "synthetic-setup",
            inputRevisionId: "synthetic-input",
            stage: "analysis",
            state: "paused",
            reason: "outcome_unknown",
            trace_id: null,
            explanation: null,
            checkpoint: false,
            section: null,
            cancellationRequested: false,
            attempts: 1,
            retryRemaining: 1,
            callBudgetRemaining: 19,
            callBudgetLimit: 20,
            retired: true,
            runBudgetRemaining: 1,
            usage: { kind: "unknown" },
            failureCode: null,
            canRetry: false,
            unknownAttemptId: "synthetic-attempt",
            provider: "openrouter",
            model: "synthetic-model",
          },
        ],
      }),
    ),
  )
  // When
  render(
    <LanguageProvider>
      <JobRoutes />
    </LanguageProvider>,
  )
  await screen.findByText("synthetic-job")
  // Then
  expect(screen.queryByRole("button", { name: /Approve retry/i })).toBeNull()
})
