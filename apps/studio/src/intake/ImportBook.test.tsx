// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { LanguageProvider } from "../i18n/LanguageProvider.tsx"
import { ImportBook } from "./ImportBook.tsx"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
it.each([
  ["synthetic.epub", "application/epub+zip"],
  ["synthetic.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ["synthetic.txt", "text/plain"],
  ["synthetic.pdf", "application/pdf"],
])("sends the selected %s to local intake with its format media type", async (name, media) => {
  // Given
  const request = vi.fn(async () =>
    Response.json(
      {
        id: "import-fixture",
        state: "queued",
        bytes: 10,
        normalizationRevisionId: "revision-fixture",
      },
      { status: 202 },
    ),
  )
  vi.stubGlobal("fetch", request)
  render(
    <LanguageProvider>
      <ImportBook />
    </LanguageProvider>,
  )
  const file = new File(["synthetic"], name, { type: media })
  fireEvent.change(screen.getByLabelText(/Choose/), { target: { files: { item: () => file } } })
  // When
  fireEvent.submit(screen.getByRole("button", { name: /Import/ }))
  // Then
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      "/api/imports/upload",
      expect.objectContaining({ headers: { "Content-Type": media }, body: file }),
    ),
  )
  expect(await screen.findByRole("link", { name: "Read this book" })).toHaveProperty(
    "pathname",
    "/sources/revision-fixture",
  )
})

it("refuses safely when intake returns an unexpected private error string", async () => {
  // Given
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ error: "/private/synthetic.xml secret" }, { status: 422 })),
  )
  render(
    <LanguageProvider>
      <ImportBook />
    </LanguageProvider>,
  )
  fireEvent.change(screen.getByLabelText(/Choose/), {
    target: { files: { item: () => new File(["x"], "fixture.epub") } },
  })
  // When
  fireEvent.submit(screen.getByRole("button", { name: /Import/ }))
  // Then
  expect((await screen.findByRole("alert")).textContent).not.toContain("/private/")
})

function mount() {
  render(
    <LanguageProvider>
      <ImportBook />
    </LanguageProvider>,
  )
}
function choose(name: string) {
  const file = new File(["synthetic"], name)
  fireEvent.change(screen.getByLabelText(/Choose/), { target: { files: { item: () => file } } })
}

it("keeps Import document disabled with a labelled picker until a file is chosen", () => {
  // Given / When
  mount()
  // Then
  expect(screen.getByLabelText(/Choose/)).toHaveProperty("type", "file")
  expect(screen.getByRole("button", { name: "Import document" })).toHaveProperty("disabled", true)
})

it("shows a queued receipt without a reader link when no normalization exists", async () => {
  // Given
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ id: "queued-fixture", state: "queued", bytes: 7 }, { status: 202 }),
    ),
  )
  mount()
  choose("queued.txt")
  // When
  fireEvent.submit(screen.getByRole("button", { name: /Import/ }))
  // Then
  expect((await screen.findByRole("status")).textContent).toContain("queued-fixture")
  expect(screen.queryByRole("link", { name: "Read this book" })).toBeNull()
  expect(screen.getByRole("link", { name: "View your sources" })).toHaveProperty(
    "pathname",
    "/sources",
  )
})

it("disables the action and shows busy text while an import is pending", async () => {
  // Given
  let finish: (response: Response) => void = () => undefined
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise<Response>((resolve) => (finish = resolve))),
  )
  mount()
  choose("pending.txt")
  // When
  fireEvent.submit(screen.getByRole("button", { name: /Import/ }))
  // Then
  const busy = await screen.findByRole("button", { name: "Importing…" })
  expect(busy).toHaveProperty("disabled", true)
  finish(Response.json({ id: "done", state: "queued", bytes: 1 }, { status: 202 }))
  expect(await screen.findByRole("button", { name: "Import document" })).toHaveProperty(
    "disabled",
    false,
  )
})

it("keeps the earlier receipt visible when a later import is refused", async () => {
  // Given
  const answers = [
    Response.json(
      { id: "first-fixture", state: "queued", bytes: 3, normalizationRevisionId: "rev-first" },
      { status: 202 },
    ),
    Response.json({ error: "invalid-encoding" }, { status: 422 }),
  ]
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => answers.shift() ?? Response.error()),
  )
  mount()
  choose("first.txt")
  fireEvent.submit(screen.getByRole("button", { name: /Import/ }))
  await screen.findByRole("link", { name: "Read this book" })
  choose("second.txt")
  // When
  fireEvent.submit(screen.getByRole("button", { name: /Import/ }))
  // Then
  expect((await screen.findByRole("alert")).textContent).toContain("The text is not valid UTF-8.")
  expect(screen.getByRole("heading", { name: "Earlier acceptance" })).toBeTruthy()
  expect(screen.getByRole("link", { name: "Read this book" })).toHaveProperty(
    "pathname",
    "/sources/rev-first",
  )
})

it("keeps the earlier receipt visible when a later import is interrupted", async () => {
  // Given
  const answers: Array<() => Promise<Response>> = [
    async () => Response.json({ id: "first-fixture", state: "queued", bytes: 3 }, { status: 202 }),
    async () => {
      throw new TypeError("network")
    },
  ]
  vi.stubGlobal(
    "fetch",
    vi.fn(() => (answers.shift() ?? (async () => Response.error()))()),
  )
  mount()
  choose("first.txt")
  fireEvent.submit(screen.getByRole("button", { name: /Import/ }))
  await screen.findByRole("status")
  choose("second.txt")
  // When
  fireEvent.submit(screen.getByRole("button", { name: /Import/ }))
  // Then
  expect((await screen.findByRole("alert")).textContent).toContain("Import interrupted.")
  expect(screen.getByRole("heading", { name: "Earlier acceptance" })).toBeTruthy()
  expect(screen.getByRole("status").textContent).toContain("first-fixture")
})
