// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { LanguageProvider } from "../i18n/LanguageProvider.tsx"
import { LANGUAGE_STORAGE_KEY } from "../i18n/preference.ts"
import { SelectedLibraryStudy } from "../library/client.ts"
import { JobRoutes } from "./JobRoutes.tsx"

const base = {
  studyId: "study-1",
  sourceRevisionId: "revision-1",
  setupRevisionId: "setup-1",
  inputRevisionId: "input-1",
  stage: "analysis",
  reason: null,
  trace_id: null,
  explanation: null,
  checkpoint: true,
  section: null,
  cancellationRequested: false,
  attempts: 1,
  retryRemaining: 2,
  callBudgetRemaining: 60,
  runBudgetRemaining: 3,
  usage: { kind: "known", inputTokens: 10, outputTokens: 20 },
  failureCode: null,
  canRetry: true,
  unknownAttemptId: null,
  provider: "openrouter",
  model: "model-x",
}
const failed = { ...base, id: "job-failed", state: "failed", failureCode: "provider-error" }
const running = { ...base, id: "job-running", state: "running" }
const unknownOutcome = {
  ...base,
  id: "job-unknown",
  state: "running",
  unknownAttemptId: "attempt-1",
}

const hasJapanese = /[\u3040-\u30ff\u4e00-\u9fff]/

function open(locale: "en" | "ja", jobs: readonly object[]): void {
  window.history.replaceState(null, "", "/jobs")
  localStorage.setItem(LANGUAGE_STORAGE_KEY, locale)
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ jobs, providerCharges: "not-returned" })),
  )
  render(
    <LanguageProvider>
      <JobRoutes />
    </LanguageProvider>,
  )
}

beforeEach(() => localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it.each(["en", "ja"] as const)(
  "offers the same-study interview after completed questions in %s",
  async (locale) => {
    // Given
    open(locale, [{ ...base, id: "questions-done", stage: "questions", state: "completed" }])
    // When
    await screen.findByRole("heading", {
      name: locale === "en" ? "Questions · Completed" : "質問 · 完了",
    })
    const links = screen.getAllByRole("link", {
      name: locale === "en" ? "Interview questions" : "読書の質問",
    })
    // Then
    expect(links.map((link) => link.getAttribute("href"))).toContain(
      `/interviews/study-1?lang=${locale}`,
    )
  },
)

describe("Given Japanese is the app language", () => {
  it.each([
    ["synthesis", "統合"],
    ["questions", "質問"],
    ["brief", "読書方針"],
    ["evidence", "根拠の確認"],
    ["publication", "公開承認"],
    ["artifact", "ファイル出力"],
  ] as const)("localizes the known %s stage", async (stage, label) => {
    open("ja", [{ ...base, id: "job-stage", stage, state: "completed" }])
    expect(await screen.findByRole("heading", { name: `${label} · 完了` })).toBeDefined()
  })

  it("localizes recorded transmission and extraction status labels", async () => {
    open("ja", [
      {
        ...failed,
        inputCoverage: [
          {
            extraction: "partial",
            transmission: "window-only",
            processing: "not-established",
            requestHash: "a".repeat(64),
            ranges: [],
            reviewedRanges: [],
            omissions: [],
          },
        ],
      },
    ])
    expect(await screen.findByText("送信内容 1 · この範囲のみ")).toBeDefined()
    expect(screen.getByText("抽出：一部 · 処理：未確認")).toBeDefined()
  })
  it("When jobs load Then the ledger and each job are Japanese only, with identifiers kept", async () => {
    open("ja", [failed, running])
    expect(await screen.findByRole("heading", { name: "学習の進行状況" })).toBeDefined()
    expect(screen.getByRole("button", { name: "状態を更新" })).toBeDefined()
    expect(screen.getByRole("heading", { name: /失敗/ })).toBeDefined()
    expect(screen.getByRole("heading", { name: /処理中/ })).toBeDefined()
    expect(screen.getByRole("button", { name: "再試行を承認" })).toBeDefined()
    expect(screen.getByText("job-failed")).toBeDefined()
    expect(document.body.textContent).not.toMatch(
      /Study progress|Refresh status|Approve retry|Checkpoint/,
    )
  })

  it("When an unknown-outcome job is shown Then the decision forms are Japanese", async () => {
    open("ja", [unknownOutcome])
    expect(await screen.findByRole("heading", { name: "結果を確認できません" })).toBeDefined()
    expect(screen.getByRole("heading", { name: "作業を停止" })).toBeDefined()
    expect(screen.getByRole("button", { name: "停止を確定" })).toBeDefined()
    expect(document.body.textContent).not.toMatch(/Outcome unknown|Confirm stop/)
  })

  it("When there are no jobs Then the empty state is Japanese", async () => {
    open("ja", [])
    expect(await screen.findByText(/現在の承認済み設定には作業がありません/)).toBeDefined()
    expect(document.body.textContent).not.toMatch(/No jobs on a current/)
  })

  it("When jobs cannot be read Then the alert is Japanese", async () => {
    window.history.replaceState(null, "", "/jobs")
    localStorage.setItem(LANGUAGE_STORAGE_KEY, "ja")
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 500 })),
    )
    render(
      <LanguageProvider>
        <JobRoutes />
      </LanguageProvider>,
    )
    const alert = (await screen.findByRole("alert")).textContent ?? ""
    expect(alert).toContain("作業を取得できません")
    expect(alert).not.toMatch(/Jobs unavailable/)
  })
})

describe("Given English is the app language", () => {
  it("When jobs load Then no Japanese text appears anywhere on the page", async () => {
    open("en", [failed, running, unknownOutcome])
    expect(await screen.findByRole("heading", { name: "Study progress" })).toBeDefined()
    expect(screen.getByRole("button", { name: "Refresh status" })).toBeDefined()
    expect(screen.getByRole("heading", { name: /Failed/ })).toBeDefined()
    expect(screen.getAllByRole("button", { name: "Approve retry" }).length).toBeGreaterThan(0)
    expect(document.body.textContent).not.toMatch(hasJapanese)
  })
})

it.each([
  { scope: "setup-1", visible: true },
  { scope: "missing-setup", visible: false },
])(
  "keeps explicit progress scope $scope without relying on a saved study selection",
  async ({ scope, visible }) => {
    // Given
    window.history.replaceState(null, "", `/jobs?setup=${scope}`)
    localStorage.setItem(LANGUAGE_STORAGE_KEY, "en")
    const request = vi.fn(async (_path: string, options?: RequestInit) => {
      if (options?.method && options.method !== "GET")
        throw new TypeError("Progress read must not act on jobs")
      return Response.json({
        jobs: [
          { ...base, id: "linked-job", state: "completed" },
          { ...base, id: "other-job", setupRevisionId: "other-setup", state: "completed" },
        ],
        providerCharges: "not-returned",
      })
    })
    vi.stubGlobal("fetch", request)
    // When
    render(
      <LanguageProvider>
        <SelectedLibraryStudy value={null}>
          <JobRoutes />
        </SelectedLibraryStudy>
      </LanguageProvider>,
    )
    // Then
    if (visible) expect(await screen.findByText("linked-job")).toBeDefined()
    else await screen.findByText(/No jobs on a current/)
    expect(screen.queryByText("other-job")).toBeNull()
    expect(request).toHaveBeenCalledTimes(1)
  },
)
