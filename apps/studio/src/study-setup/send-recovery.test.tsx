// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { LanguageProvider } from "../i18n/LanguageProvider.tsx"
import { SetupRoutes } from "./SetupRoutes.tsx"

const review = {
  setup: {
    id: "setup-fixture",
    analysis: {
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      normalizationRevisionId: "revision-fixture",
      scope: { kind: "whole-document", selected: [{ resourcePath: "book.txt", blockIds: ["b"] }] },
    },
  },
  normalization: {
    id: "revision-fixture",
    editionId: "edition-fixture",
    editionHash: "a".repeat(64),
    parserVersion: "2",
    normalizerVersion: "2",
    coverage: "partial",
    resources: [
      {
        path: "book.txt",
        role: "main-chapter",
        status: "included",
        blocks: [{ id: "b", text: "Synthetic" }],
      },
    ],
  },
  available: true,
}
const accepted = {
  decision: "send",
  grantId: "grant-fixture",
  analysisProgress: "not-scheduled",
  progressUrl: "/jobs?setup=setup-fixture",
  canResume: true,
}
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
function openReview() {
  window.history.replaceState(null, "", "/sources/revision-fixture/setup/setup-fixture")
  render(
    <LanguageProvider>
      <SetupRoutes />
    </LanguageProvider>,
  )
}

it("announces pending Send immediately and admits only one decision while it waits", async () => {
  // Given
  let finish: (response: Response) => void = () => {
    throw new TypeError("Send not started")
  }
  const request = vi.fn(async (_path: string, options?: RequestInit) => {
    if (options?.method !== "POST") return Response.json(review)
    return new Promise<Response>((resolve) => {
      finish = resolve
    })
  })
  vi.stubGlobal("fetch", request)
  openReview()
  const send = await screen.findByRole("button", { name: "Send" })
  // When
  fireEvent.click(send)
  fireEvent.click(send)
  // Then
  expect(screen.getByRole("status").textContent).toMatch(/saving.*consent/i)
  expect(screen.getByRole("button", { name: /saving/i }).hasAttribute("disabled")).toBe(true)
  expect(request.mock.calls.filter((call) => call[1]?.method === "POST")).toHaveLength(1)
  finish(Response.json(accepted))
  await screen.findByRole("heading", { name: "Consent saved" })
})

it("resumes missing scheduling from the persisted review without asking for new consent", async () => {
  // Given
  const request = vi.fn(async (_path: string, options?: RequestInit) =>
    Response.json(
      options?.method === "POST" ? { ...accepted, analysisProgress: "queued" } : accepted,
    ),
  )
  vi.stubGlobal("fetch", request)
  openReview()
  // When
  fireEvent.click(await screen.findByRole("button", { name: "Resume scheduling" }))
  // Then
  await waitFor(() =>
    expect(
      document.querySelector("[data-analysis-progress]")?.getAttribute("data-analysis-progress"),
    ).toBe("queued"),
  )
  expect(document.querySelector("[data-grant]")?.getAttribute("data-grant")).toBe("grant-fixture")
  expect(request.mock.calls.filter((call) => call[1]?.method === "POST")).toHaveLength(1)
  expect(screen.queryByRole("button", { name: "Send" })).toBeNull()
})

it.each(["not-scheduled", "attention", "unknown", "bank-incompatible", "analysis-ready"])(
  "uses a consent-only heading for persisted %s without claiming a transmission",
  async (analysisProgress) => {
    // Given
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ ...accepted, analysisProgress })),
    )
    // When
    openReview()
    // Then
    await screen.findByRole("heading", { name: "Consent saved" })
    expect(screen.queryByRole("heading", { name: "Transmission approved" })).toBeNull()
  },
)

it("shows the actual saved refusal and no resume action after an unsupported-model result", async () => {
  // Given
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ ...accepted, schedulingFailure: "unsupported-model", canResume: false }),
    ),
  )
  // When
  openReview()
  // Then
  expect((await screen.findByRole("alert")).textContent).toContain("unsupported-model")
  expect(screen.queryByRole("button", { name: "Resume scheduling" })).toBeNull()
  expect(screen.queryByRole("heading", { name: "Transmission approved" })).toBeNull()
})

it("names an uncertain questions outcome and directs resolution to the existing job", async () => {
  // Given
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ ...accepted, analysisProgress: "questions-unknown", canResume: false }),
    ),
  )
  // When
  openReview()
  // Then
  await screen.findByRole("heading", { name: "Consent saved" })
  expect((await screen.findByRole("status")).textContent).toMatch(/question.*unknown.*resolve/i)
  expect(screen.queryByRole("button", { name: "Resume scheduling" })).toBeNull()
})

it.each(["reload", "lost-response"])(
  "recovers persisted consent after %s without a second Send",
  async (mode) => {
    // Given
    let gets = 0
    const request = vi.fn(async (_path: string, options?: RequestInit) => {
      if (options?.method === "POST") throw new TypeError("Synthetic lost response")
      gets += 1
      return Response.json(mode === "lost-response" && gets === 1 ? review : accepted)
    })
    vi.stubGlobal("fetch", request)
    // When
    openReview()
    if (mode === "lost-response")
      fireEvent.click(await screen.findByRole("button", { name: "Send" }))
    // Then
    await screen.findByRole("heading", { name: "Consent saved" })
    expect(screen.getByRole("button", { name: /resume scheduling/i })).toBeTruthy()
    expect(screen.getByRole("link", { name: "View analysis progress" }).getAttribute("href")).toBe(
      accepted.progressUrl,
    )
    await waitFor(() =>
      expect(request.mock.calls.filter((call) => call[1]?.method === "POST")).toHaveLength(
        mode === "reload" ? 0 : 1,
      ),
    )
  },
)
