// @vitest-environment happy-dom

import { PreparationReview } from "@reading-studio/contracts/setup-progress"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, expect, it } from "vitest"
import { LanguageProvider } from "../i18n/LanguageProvider.tsx"
import { PreparationPlan } from "./PreparationPlan.tsx"

afterEach(cleanup)
it("shows the immutable batched maxima and unknown-output refusal before any Send action", () => {
  // Given
  const value = PreparationReview.parse({
    state: "ready",
    reason: null,
    groupCount: 1,
    partCount: 2,
    verificationRoom: { policy: "batched-room-5", targetBytes: 12288, sampleOnly: true },
    allowance: {
      cap: 64,
      used: 0,
      remaining: 64,
      plannedAttempts: 46,
      reservedLaterAttempts: 12,
      uncertainCounts: true,
    },
    batchedMaximum: {
      reserveId: "a".repeat(64),
      maxFindingBatches: 4,
      maxVerificationJobs: 14,
      maxAnalysisJobs: 17,
      maxAnalysisAttempts: 34,
      reservedLaterAttempts: 12,
      maxTotalAttempts: 46,
      outputFitGuaranteed: false,
      refusalLimits: ["whole map", "finding/citation", "batch overflow"],
    },
  })
  // When
  render(
    <LanguageProvider>
      <PreparationPlan value={value} />
    </LanguageProvider>,
  )
  // Then
  expect(screen.getByRole("region", { name: "Batched verification maximum" })).toBeDefined()
  expect(
    document.querySelector('[data-verification-room-policy="batched-room-5"]')?.textContent,
  ).toContain("12288")
  const policy = document.querySelector(
    '[data-verification-room-policy="batched-room-5"]',
  )?.textContent
  expect(policy).toContain("ASCII/English-sized")
  expect(policy).toContain("mixed text varies")
  expect(policy).toContain("not proof that Japanese-language outputs fit")
  expect(screen.getByText(/14 verification jobs/)).toBeDefined()
  expect(screen.getByText(/17 analysis jobs/)).toBeDefined()
  expect(screen.getByText(/46 attempts/)).toBeDefined()
  expect(screen.getByText("outputFitGuaranteed=false").closest("details")).not.toBeNull()
  expect(screen.getByText(/Earlier calls remain counted/)).toBeDefined()
  expect(screen.getByText(/No automatic batch growth/)).toBeDefined()
})
