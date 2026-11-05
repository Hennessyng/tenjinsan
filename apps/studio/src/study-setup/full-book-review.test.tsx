// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { LanguageProvider } from "../i18n/LanguageProvider.tsx"
import { SetupReview as ReviewSchema } from "./client.ts"
import { syntheticFullBookReview } from "./full-book-review-fixture.ts"
import { SetupModeReview } from "./SetupModeReview.tsx"
import {
  syntheticCurrentAnalysis,
  syntheticDiscoveryNormalization,
  syntheticPreparedLocalReview,
} from "./setup-ui-fixture.ts"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  localStorage.clear()
  history.replaceState(null, "", "/")
})
function given() {
  const value = ReviewSchema.parse({
    ...syntheticPreparedLocalReview,
    normalization: syntheticDiscoveryNormalization,
    setup: {
      id: "saved-review",
      analysis: {
        ...syntheticCurrentAnalysis,
        model: "synthetic-model",
        normalizationRevisionId: "normalization-1",
        scope: {
          kind: "whole-document",
          selected: [{ resourcePath: "book.txt", blockIds: ["block-1"] }],
        },
      },
    },
  })
  const command = vi.fn(),
    decision = vi.fn()
  vi.stubGlobal("fetch", command)
  render(
    <LanguageProvider>
      <SetupModeReview value={value} onDecision={decision} busy={false} />
    </LanguageProvider>,
  )
  return { command, decision }
}
it("does not select or prepare experimental mode by default", () => {
  // Given an ordinary saved study review.
  const f = given()
  // When/Then the initial review retains ordinary actions without experimental requests.
  expect(screen.getByRole("combobox", { name: "Analysis mode" })).toHaveProperty("value", "")
  expect(screen.getByRole("button", { name: "Send" })).toHaveProperty("disabled", false)
  expect(f.command).not.toHaveBeenCalled()
})
it("prepares from the saved route, refreshes the exact binding and invalidates review on edits", async () => {
  // Given an explicit dry-run selection with synthetic server responses.
  const f = given()
  f.command.mockImplementation(() => Promise.resolve(Response.json(syntheticFullBookReview)))
  fireEvent.change(screen.getByRole("combobox", { name: "Analysis mode" }), {
    target: { value: "full-book-test-1" },
  })
  fireEvent.change(
    screen.getByRole("spinbutton", {
      name: "Proposed total source-attempt ceiling (not approval)",
    }),
    { target: { value: "300" } },
  )
  // When local preparation is explicitly requested.
  fireEvent.click(screen.getByRole("button", { name: "Prepare dry run" }))
  await screen.findByRole("heading", { name: "Shared source budget" })
  expect(f.command.mock.calls[0]?.[0]).toBe("/api/full-book-test/saved-review/prepare")
  expect(screen.getByText("Synthetic image excluded", { exact: false })).toBeDefined()
  fireEvent.click(screen.getByRole("button", { name: "Recheck this review" }))
  await waitFor(() => expect(f.command).toHaveBeenCalledTimes(2))
  const call = f.command.mock.calls[1]
  expect(call?.[0]).toBe("/api/full-book-test/saved-review/review")
  expect(call?.[1]).toMatchObject({
    body: expect.stringContaining(syntheticFullBookReview.reviewBinding),
  })
  await screen.findByRole("heading", { name: "Shared source budget" })
  fireEvent.change(screen.getByRole("spinbutton", { name: "Maximum findings" }), {
    target: { value: "60" },
  })
  // Then no stale review or sending authority survives the edit.
  expect(screen.queryByRole("heading", { name: "Shared source budget" })).toBeNull()
  expect(screen.getByRole("button", { name: "Send" })).toHaveProperty("disabled", true)
  expect(f.decision).not.toHaveBeenCalled()
})
it("clears stale review after refusal and cancels only the local panel", async () => {
  // Given a prepared review whose refresh will be refused.
  const f = given()
  f.command
    .mockResolvedValueOnce(Response.json(syntheticFullBookReview))
    .mockResolvedValueOnce(Response.json({ error: "review-stale" }, { status: 409 }))
  fireEvent.change(screen.getByRole("combobox", { name: "Analysis mode" }), {
    target: { value: "full-book-test-1" },
  })
  fireEvent.change(
    screen.getByRole("spinbutton", {
      name: "Proposed total source-attempt ceiling (not approval)",
    }),
    { target: { value: "300" } },
  )
  fireEvent.click(screen.getByRole("button", { name: "Prepare dry run" }))
  await screen.findByRole("heading", { name: "Shared source budget" })
  // When the fresh check fails and the panel is discarded.
  fireEvent.click(screen.getByRole("button", { name: "Recheck this review" }))
  await screen.findByRole("alert")
  expect(screen.queryByRole("heading", { name: "Shared source budget" })).toBeNull()
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
  // Then it returns to saved mode without issuing a run cancellation or ordinary decision.
  expect(screen.getByRole("combobox", { name: "Analysis mode" })).toHaveProperty("value", "")
  expect(f.command).toHaveBeenCalledTimes(2)
  expect(f.decision).not.toHaveBeenCalled()
})
it("keeps native sending disabled in Japanese", () => {
  // Given Japanese interface selection.
  history.replaceState(null, "", "/?lang=ja")
  const f = given()
  // When experimental preparation is selected, then its disabled native action is localized.
  fireEvent.change(screen.getByRole("combobox", { name: "分析モード" }), {
    target: { value: "full-book-test-1" },
  })
  expect(screen.getByRole("button", { name: "送信" })).toHaveProperty("disabled", true)
  expect(screen.getByRole("button", { name: "ドライランを準備" })).toBeDefined()
  expect(f.command).not.toHaveBeenCalled()
})
it("requires explicit experimental selection and never calls ordinary Send", () => {
  // Given a saved route and no selected experimental mode.
  const f = given()
  // When the user opts into the dry run.
  fireEvent.change(screen.getByRole("combobox", { name: "Analysis mode" }), {
    target: { value: "full-book-test-1" },
  })
  // Then native Send is disabled and selecting the mode grants or sends nothing.
  expect(screen.getByRole("button", { name: "Send" })).toHaveProperty("disabled", true)
  expect(screen.getByRole("status").textContent).toContain("Native sending is disabled")
  expect(screen.getByRole("button", { name: "Prepare dry run" })).toBeDefined()
  expect(f.command).not.toHaveBeenCalled()
  expect(f.decision).not.toHaveBeenCalled()
})
