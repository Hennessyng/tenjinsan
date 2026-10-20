// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { LanguageProvider } from "../i18n/LanguageProvider.tsx"
import { InterviewRoutes } from "./InterviewRoutes.tsx"

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
})

it.each([
  ["setup-required", "/sources/source-23/setup", "Complete study setup"],
  ["review-required", "/sources/source-23/setup/setup-23", "Review setup before sending"],
] as const)(
  "offers the correct next action for %s without any write",
  async (kind, href, label) => {
    // Given
    window.history.replaceState(null, "", "/interviews/study-23?lang=en")
    const request = vi.fn(async (path: string, _options?: RequestInit) =>
      path.includes("/api/interviews/")
        ? Response.json({ error: "Interview unavailable" }, { status: 404 })
        : Response.json({ kind, actionHref: href }),
    )
    vi.stubGlobal("fetch", request)
    // When
    render(
      <LanguageProvider>
        <InterviewRoutes />
      </LanguageProvider>,
    )
    // Then
    const action = await screen.findByRole("link", { name: label })
    expect(action.getAttribute("href")).toBe(`${href}?lang=en`)
    expect(request.mock.calls.every(([, options]) => !options?.method)).toBe(true)
  },
)

it.each(["analysis", "questions"] as const)(
  "names the pending %s stage and links progress",
  async (stage) => {
    // Given
    window.history.replaceState(null, "", "/interviews/study-23?lang=ja")
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string) =>
        path.includes("/api/interviews/")
          ? Response.json({ error: "Interview unavailable" }, { status: 404 })
          : Response.json({
              kind: "progress",
              stage,
              state: "queued",
              reason: null,
              actionHref: "/jobs?setup=setup-23",
            }),
      ),
    )
    // When
    render(
      <LanguageProvider>
        <InterviewRoutes />
      </LanguageProvider>,
    )
    // Then
    const heading = await screen.findByRole("heading", {
      level: 1,
      name: stage === "analysis" ? "資料の分析" : "質問の作成",
    })
    expect(heading).toBeTruthy()
    expect(screen.getByRole("link", { name: "進捗と必要な操作を見る" }).getAttribute("href")).toBe(
      "/jobs?setup=setup-23&lang=ja",
    )
  },
)

it.each([500, 503])(
  "does not invent missing setup when status retrieval fails (%s)",
  async (status) => {
    // Given
    window.history.replaceState(null, "", "/interviews/study-23?lang=en")
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string) =>
        path.includes("/api/interviews/")
          ? Response.json({ error: "Interview unavailable" }, { status: 404 })
          : Response.json({ error: "unavailable" }, { status }),
      ),
    )
    // When
    render(
      <LanguageProvider>
        <InterviewRoutes />
      </LanguageProvider>,
    )
    // Then
    expect(
      await screen.findByRole("heading", { name: "Could not check interview status" }),
    ).toBeTruthy()
    expect(screen.queryByRole("link", { name: "Complete study setup" })).toBeNull()
    expect(screen.getByRole("link", { name: "Check status again" }).getAttribute("href")).toBe(
      "/interviews/study-23?lang=en",
    )
  },
)

it.each(["cancelled", "not-scheduled"] as const)(
  "renders the %s question stage and only read-only recovery",
  async (state) => {
    // Given
    window.history.replaceState(null, "", "/interviews/study-23?lang=en")
    const request = vi.fn(async (path: string, _options?: RequestInit) =>
      path.includes("/api/interviews/")
        ? Response.json({ error: "Interview unavailable" }, { status: 404 })
        : Response.json({
            kind: "progress",
            stage: "questions",
            state,
            reason: null,
            actionHref: "/jobs?setup=setup-23",
          }),
    )
    vi.stubGlobal("fetch", request)
    // When
    render(
      <LanguageProvider>
        <InterviewRoutes />
      </LanguageProvider>,
    )
    // Then
    expect(await screen.findByRole("heading", { name: "Question generation" })).toBeTruthy()
    expect(screen.getByRole("status").textContent).toContain(
      state === "cancelled" ? "was cancelled" : "No pending work is recorded",
    )
    expect(
      screen.getByRole("link", { name: "View progress and next actions" }).getAttribute("href"),
    ).toBe("/jobs?setup=setup-23&lang=en")
    expect(request.mock.calls.every(([, options]) => !options?.method)).toBe(true)
  },
)

it.each(["en", "ja"] as const)("distinguishes a genuinely missing study in %s", async (locale) => {
  // Given
  window.history.replaceState(null, "", `/interviews/missing-study?lang=${locale}`)
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) =>
      path.includes("/api/interviews/")
        ? Response.json({ error: "Interview unavailable" }, { status: 404 })
        : Response.json({ kind: "missing-study" }),
    ),
  )
  // When
  render(
    <LanguageProvider>
      <InterviewRoutes />
    </LanguageProvider>,
  )
  // Then
  expect(
    await screen.findByRole("heading", {
      name: locale === "en" ? "Study not found" : "学習が見つかりません",
    }),
  ).toBeTruthy()
  expect(screen.queryByRole("status")).toBeNull()
  expect(screen.queryByText("Complete study setup")).toBeNull()
})

it.each([
  ["en", "budget-exhausted", "approved call limit"],
  ["ja", "budget-exhausted", "承認済みの呼び出し上限"],
  ["en", "outcome_unknown", "may have reached the provider"],
  ["ja", "outcome_unknown", "届いている可能性"],
  ["en", "input-limit", "execution input/request limit"],
  ["ja", "input-limit", "実行時の入力"],
] as const)(
  "explains %s reason %s instead of showing only an opaque code",
  async (locale, reason, explanation) => {
    // Given
    window.history.replaceState(null, "", `/interviews/study-23?lang=${locale}`)
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string) =>
        path.includes("/api/interviews/")
          ? Response.json({ error: "Interview unavailable" }, { status: 404 })
          : Response.json({
              kind: "progress",
              stage: "analysis",
              state: reason === "input-limit" ? "failed" : "paused",
              reason,
              actionHref: "/jobs?setup=setup-23",
            }),
      ),
    )
    // When
    render(
      <LanguageProvider>
        <InterviewRoutes />
      </LanguageProvider>,
    )
    // Then
    expect(await screen.findByText(new RegExp(explanation))).toBeTruthy()
    if (reason === "budget-exhausted")
      expect(screen.getByRole("status").textContent).not.toMatch(/required decision|必要な判断/)
  },
)
