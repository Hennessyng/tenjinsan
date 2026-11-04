// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { LanguageProvider } from "../i18n/LanguageProvider.tsx"
import { SetupReview as ReviewSchema, SetupDecision } from "./client.ts"
import { SetupReview } from "./SetupReview.tsx"
import { SetupSavedStatus } from "./SetupSavedStatus.tsx"
import {
  syntheticCurrentAnalysis,
  syntheticDiscoveryNormalization,
  syntheticPreparedLocalReview,
} from "./setup-ui-fixture.ts"

afterEach(() => {
  cleanup()
  history.replaceState({}, "", "/?lang=en")
})
const purpose = { version: "analysis-evaluation-1", terminal: "verified-analysis" } as const
function purposeReview(evaluation = true) {
  return ReviewSchema.parse({
    ...syntheticPreparedLocalReview,
    setup: {
      id: "evaluation-review",
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
      ...(evaluation ? { purpose, purposeTargetBound: false } : {}),
    },
  })
}
it.each(["en", "ja"] as const)(
  "describes only book and derived material for evaluation consent in %s",
  (locale) => {
    history.replaceState({}, "", `/?lang=${locale}`)
    render(
      <LanguageProvider>
        <SetupReview value={purposeReview()} busy={false} onDecision={vi.fn()} />
      </LanguageProvider>,
    )
    const scope = screen.getByText(locale === "ja" ? /^範囲：/u : /^Scope:/u)
    expect(scope.textContent).toContain(locale === "ja" ? "選択済みの本文" : "selected book text")
    expect(scope.textContent).not.toMatch(/reading brief|reader context|読書方針|読者背景/iu)
  },
)
it.each(["en", "ja"] as const)("removes dead-end Revise but retains Cancel in %s", (locale) => {
  history.replaceState({}, "", `/?lang=${locale}`)
  const decide = vi.fn()
  render(
    <LanguageProvider>
      <SetupReview value={purposeReview()} busy={false} onDecision={decide} />
    </LanguageProvider>,
  )
  expect(screen.queryByRole("button", { name: locale === "ja" ? "修正する" : "Revise" })).toBeNull()
  expect(
    screen.getByText(
      locale === "ja"
        ? /評価用の学習は設定を変更できません/u
        : /Evaluation studies cannot be revised/u,
    ),
  ).toBeDefined()
  fireEvent.click(screen.getByRole("button", { name: locale === "ja" ? "取り消す" : "Cancel" }))
  expect(decide).toHaveBeenCalledExactlyOnceWith("cancel")
})
it("retains ordinary study scope and Revise", () => {
  render(
    <LanguageProvider>
      <SetupReview value={purposeReview(false)} busy={false} onDecision={vi.fn()} />
    </LanguageProvider>,
  )
  expect(screen.getByRole("button", { name: "Revise" }).hasAttribute("disabled")).toBe(false)
  expect(screen.getByText(/^Scope:/u).textContent).toContain("reader context")
})
it("shows the distinct analysis-only20 purpose and blocks Send until its explicit target is bound", () => {
  const value = ReviewSchema.parse({
    ...syntheticPreparedLocalReview,
    setup: {
      id: "evaluation-setup",
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
      purpose,
      purposeTargetBound: false,
      allowance: {
        cap: 20,
        used: 0,
        remaining: 20,
        plannedAttempts: 18,
        reservedLaterAttempts: 0,
        uncertainCounts: true,
      },
      batchedMaximum: {
        reserveId: "a".repeat(64),
        maxFindingBatches: 3,
        maxVerificationJobs: 7,
        maxAnalysisJobs: 9,
        maxAnalysisAttempts: 18,
        reservedLaterAttempts: 0,
        maxTotalAttempts: 18,
        outputFitGuaranteed: false,
        refusalLimits: [],
      },
    },
  })
  render(
    <LanguageProvider>
      <SetupReview
        value={value}
        busy={false}
        onDecision={() => {
          throw new TypeError("Unbound purpose must not send")
        }}
      />
    </LanguageProvider>,
  )
  const send = screen.getByRole("button", { name: "Send" })
  expect(send.hasAttribute("disabled")).toBe(true)
  expect(screen.getByText(/this new consent ends at verified analysis/)).toBeDefined()
  expect(screen.getByText(/unchanged cumulative 20-attempt source allowance/)).toBeDefined()
  expect(screen.queryByText(/at most 8 original windows fit/)).toBeNull()
  expect(
    document.getElementById(send.getAttribute("aria-describedby") ?? "")?.textContent,
  ).toContain("explicit controlled analysis target")
})
it("does not advertise resume, questions or exports after verified analysis", () => {
  const value = SetupDecision.parse({
    decision: "send",
    grantId: "grant-evaluation",
    analysisProgress: "analysis-ready",
    terminal: "verified-analysis",
    purpose,
    canResume: false,
  })
  if (value.decision !== "send") throw new TypeError("Missing saved purpose")
  render(
    <LanguageProvider>
      <SetupSavedStatus
        value={{ ...value, progressUrl: "/jobs?setup=evaluation" }}
        busy={false}
        onResume={() => {
          throw new TypeError("Terminal purpose must not resume")
        }}
      />
    </LanguageProvider>,
  )
  expect(screen.getByText(/Verified analysis complete/)).toBeDefined()
  expect(screen.queryByRole("button")).toBeNull()
  expect(screen.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
    "/jobs?setup=evaluation",
  ])
})
