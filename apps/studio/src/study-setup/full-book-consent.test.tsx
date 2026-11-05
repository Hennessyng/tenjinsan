// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { LanguageProvider } from "../i18n/LanguageProvider.tsx"
import { FullBookConsentPanel } from "./FullBookConsentPanel.tsx"
import { FullBookReview, fullBookOptions } from "./full-book-client.ts"
import { syntheticFullBookReview } from "./full-book-review-fixture.ts"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  localStorage.clear()
})
function review() {
  return FullBookReview.parse({
    ...syntheticFullBookReview,
    hierarchy: { ...syntheticFullBookReview.hierarchy, policy: fullBookOptions(300, 120).policy },
    route: {
      ...syntheticFullBookReview.route,
      recipient: {
        provider: "chatgpt-subscription",
        accountId: "synthetic-recipient",
        workspaceId: null,
        installationId: "synthetic-installation",
        connectionRevision: 1,
        billingRoute: "subscription-provider-managed",
      },
    },
    runtime: {
      collectorBytes: 128000,
      timeoutMs: 90000,
      build: {
        kind: "fixture-not-live-evidence",
        sha256: "d".repeat(64),
        version: "fixture-1",
        binding: "d".repeat(64),
      },
    },
    consent: {
      runtimeBinding: "d".repeat(64),
      recipientBinding: "c".repeat(64),
      planBinding: "e".repeat(64),
      omissionsHash: "f".repeat(64),
      maxAttempts: 180,
      priorSpent: 7,
      priorUnknown: 1,
      priorUsageUnknown: 1,
      priorHeld: 18,
      sourceVersion: 2,
      sourceCeiling: 300,
      coverage: "partial",
      omissionCount: 1,
    },
  })
}
it("requires four distinct unchecked acknowledgements and never grants on preparation alone", () => {
  // Given a bound, current review whose budget and runtime have not been acknowledged.
  const fetch = vi.fn()
  vi.stubGlobal("fetch", fetch)
  render(
    <LanguageProvider>
      <FullBookConsentPanel review={review()} onSaved={vi.fn()} />
    </LanguageProvider>,
  )
  // When/Then initial consent is unavailable until every distinct acknowledgement is explicitly selected.
  const checks = screen.getAllByRole("checkbox")
  expect(checks).toHaveLength(4)
  expect(checks.every((check) => !(check instanceof HTMLInputElement) || !check.checked)).toBe(true)
  const save = screen.getByRole("button", { name: "Save exact consent — paused" })
  expect(save).toHaveProperty("disabled", true)
  checks.slice(0, 3).forEach((check) => {
    fireEvent.click(check)
  })
  expect(save).toHaveProperty("disabled", true)
  const last = checks[3]
  if (!last) throw new TypeError("Missing acknowledgement")
  fireEvent.click(last)
  expect(save).toHaveProperty("disabled", false)
  expect(fetch).not.toHaveBeenCalled()
})
