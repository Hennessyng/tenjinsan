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
