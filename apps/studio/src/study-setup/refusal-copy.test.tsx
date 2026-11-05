// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, expect, it } from "vitest"
import { LanguageProvider } from "../i18n/LanguageProvider.tsx"
import { SetupReview as ReviewSchema } from "./client.ts"
import { SetupReview } from "./SetupReview.tsx"
import {
  syntheticCurrentAnalysis,
  syntheticDiscoveryNormalization,
  syntheticPreparedLocalReview,
} from "./setup-ui-fixture.ts"

afterEach(cleanup)
it("places a plain-language budget refusal beside disabled Send and links its accessible description", () => {
  const value = ReviewSchema.parse({
    ...syntheticPreparedLocalReview,
    setup: {
      id: "setup-1",
      analysis: {
        ...syntheticCurrentAnalysis,
        model: "study-model",
        normalizationRevisionId: "normalization-1",
        scope: {
          kind: "whole-document",
          selected: [{ resourcePath: "book.txt", blockIds: ["block-1"] }],
        },
      },
    },
    normalization: syntheticDiscoveryNormalization,
    preparation: {
      ...syntheticPreparedLocalReview.preparation,
      state: "blocked",
      reason: "attempt-budget-limit",
      partCount: 9,
    },
  })
  render(
    <LanguageProvider>
      <SetupReview
        value={value}
        busy={false}
        onDecision={() => {
          throw new TypeError("Disabled Send must not dispatch")
        }}
      />
    </LanguageProvider>,
  )
  const send = screen.getByRole("button", { name: "Send" })
  expect(send.hasAttribute("disabled")).toBe(true)
  const describedBy = send.getAttribute("aria-describedby")
  expect(describedBy).toBeTruthy()
  const reason = describedBy && document.getElementById(describedBy)
  expect(reason && reason.closest(".setup-actions")).toBe(send.closest(".setup-actions"))
  expect(reason && reason.textContent).toMatch(/remaining allowance/i)
  expect(reason && reason.textContent).not.toContain("attempt-budget-limit")
  expect(document.querySelector(".setup code")).toBeNull()
})
