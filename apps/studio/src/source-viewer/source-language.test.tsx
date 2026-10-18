// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { LanguageProvider } from "../i18n/LanguageProvider.tsx"
import { LANGUAGE_STORAGE_KEY } from "../i18n/preference.ts"
import { ImportBook } from "../intake/ImportBook.tsx"
import { SourceRoutes } from "./SourceRoutes.tsx"

function open(path: string, locale: "en" | "ja") {
  window.history.replaceState(null, "", path)
  localStorage.setItem(LANGUAGE_STORAGE_KEY, locale)
}

beforeEach(() => localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const reader = {
  edition: {
    id: "edition-synthetic",
    title: "Synthetic Title",
    originalHash: "a".repeat(64),
    originalBlobHash: "a".repeat(64),
    format: "pdf",
  },
  normalization: {
    id: "revision-synthetic",
    editionId: "edition-synthetic",
    editionHash: "a".repeat(64),
    parserVersion: "pdf-2",
    normalizerVersion: "2",
    coverage: "partial",
    omissions: [{ path: "pdf/page-2", reason: "no-selectable-text" }],
    resources: [
      {
        path: "pdf/page-1",
        role: "main-chapter",
        status: "included",
        blocks: [
          { id: "b1", text: "Source sentence kept as is.", locator: { kind: "pdf", page: 1 } },
        ],
      },
    ],
  },
  chapter: 0,
  span: null,
}

describe("Given Japanese is the app language", () => {
  it("When the source library is empty Then its chrome is Japanese", async () => {
    open("/sources", "ja")
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ documents: [], pending: [] })),
    )
    render(
      <LanguageProvider>
        <SourceRoutes />
      </LanguageProvider>,
    )
    expect(await screen.findByRole("heading", { name: "あなたの資料" })).toBeDefined()
    expect(screen.getByText("読み込める資料はまだありません。")).toBeDefined()
  })

  it("When a source is read Then labels are Japanese and source text is untouched", async () => {
    open("/sources/revision-synthetic", "ja")
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(reader)),
    )
    render(
      <LanguageProvider>
        <SourceRoutes />
      </LanguageProvider>,
    )
    expect(await screen.findByText(/PDF 1ページ/)).toBeDefined()
    expect(screen.getByText("目次")).toBeDefined()
    expect(screen.getByText("Source sentence kept as is.", { exact: false })).toBeDefined()
    expect(screen.getByRole("heading", { name: "Synthetic Title" })).toBeDefined()
  })

  it("When the source request fails Then the alert is Japanese", async () => {
    open("/sources", "ja")
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 500 })),
    )
    render(
      <LanguageProvider>
        <SourceRoutes />
      </LanguageProvider>,
    )
    expect((await screen.findByRole("alert")).textContent).toBe(
      "資料を読み込めません。もう一度お試しください。",
    )
  })

  it("When intake refuses a file Then the refusal and code label are Japanese", async () => {
    open("/imports", "ja")
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "protected-document" }, { status: 422 })),
    )
    render(
      <LanguageProvider>
        <ImportBook />
      </LanguageProvider>,
    )
    expect(screen.getByRole("heading", { name: "本を取り込む" })).toBeDefined()
    const file = new File(["x"], "a.pdf", { type: "application/pdf" })
    fireEvent.change(screen.getByLabelText(/ファイルを選択/), {
      target: { files: { item: () => file } },
    })
    fireEvent.submit(screen.getByRole("button", { name: "文書を取り込む" }))
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("取り込みを拒否しました"),
    )
    expect(screen.getByRole("alert").textContent).toContain("パスワード保護された文書")
  })

  it("When the file type is unsupported Then the refusal is Japanese", async () => {
    open("/imports", "ja")
    render(
      <LanguageProvider>
        <ImportBook />
      </LanguageProvider>,
    )
    const file = new File(["x"], "a.xyz")
    fireEvent.change(screen.getByLabelText(/ファイルを選択/), {
      target: { files: { item: () => file } },
    })
    fireEvent.submit(screen.getByRole("button", { name: "文書を取り込む" }))
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("対応していない形式"),
    )
  })
})

describe("Given English is the app language", () => {
  it("When intake refuses a file Then English copy is kept", async () => {
    open("/imports", "en")
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "protected-document" }, { status: 422 })),
    )
    render(
      <LanguageProvider>
        <ImportBook />
      </LanguageProvider>,
    )
    const file = new File(["x"], "a.pdf", { type: "application/pdf" })
    fireEvent.change(screen.getByLabelText(/Choose/), { target: { files: { item: () => file } } })
    fireEvent.submit(screen.getByRole("button", { name: "Import document" }))
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Import refused"))
  })
})
