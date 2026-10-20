// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { App } from "../App.tsx"
import { libraryRooms, roomAt } from "./room-map.ts"

const original = {
  id: "study-original",
  editionId: "edition-original",
  title: "Original book",
  normalizationId: "rev-original",
  normalizations: ["rev-original"],
  setupId: null,
}
const imported = {
  id: "study-new",
  editionId: "edition-new",
  title: "New synthetic book",
  normalizationId: "rev-new",
  normalizations: ["rev-new"],
  setupId: null,
}
function reader() {
  return {
    edition: {
      id: "edition-new",
      title: imported.title,
      originalHash: "a".repeat(64),
      originalBlobHash: "a".repeat(64),
      format: "txt",
    },
    normalization: {
      id: "rev-new",
      editionId: "edition-new",
      editionHash: "a".repeat(64),
      parserVersion: "txt-1",
      normalizerVersion: "1",
      coverage: "complete",
      omissions: [],
      resources: [
        {
          path: "text",
          role: "main-chapter",
          status: "included",
          blocks: [
            {
              id: "new-block",
              text: "Only the newly imported source",
              locator: { kind: "txt", startLine: 1, start: 0 },
            },
          ],
        },
      ],
    },
    chapter: 0,
    span: null,
  }
}
function mount({ selected = original.id, failSwitch = false, queued = false } = {}) {
  let selection = selected
  const request = vi.fn(async (path: string, options?: RequestInit) => {
    if (path === "/api/library-context")
      return Response.json({ studies: [original, imported], selectedStudyId: selection })
    if (path === "/api/source-library") return Response.json({ documents: [], pending: [] })
    if (path === "/api/imports/upload")
      return Response.json(
        {
          id: "receipt-new",
          state: "queued",
          bytes: 10,
          ...(queued ? {} : { normalizationRevisionId: "rev-new" }),
        },
        { status: 202 },
      )
    if (path === "/api/library-selection") {
      if (failSwitch) return Response.json({ error: "/private/secret" }, { status: 503 })
      selection = JSON.parse(String(options?.body)).studyId
      return Response.json({ selectedStudyId: selection })
    }
    if (path.startsWith("/api/source-reader/rev-new")) return Response.json(reader())
    return Response.json({}, { status: 404 })
  })
  vi.stubGlobal("fetch", request)
  const root = document.createElement("div")
  root.id = "root"
  document.body.replaceChildren(root)
  window.history.replaceState(null, "", "/imports?lang=en")
  render(<App />, { container: root })
  return request
}
async function upload() {
  const picker = await screen.findByLabelText(/Choose EPUB/)
  fireEvent.change(picker, {
    target: { files: { item: () => new File(["synthetic"], "new.txt") } },
  })
  fireEvent.submit(screen.getByRole("button", { name: "Import document" }))
  return screen.findByRole("link", { name: "Read this book" })
}
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it("offers one numbered destination for both old intake and source URLs", () => {
  // Given / When
  const rooms = ["/imports", "/sources", "/sources/rev-new?chapter=2", "/?room=stacks"].map(
    (path) => roomAt(new URL(path, "http://localhost")),
  )
  // Then
  expect(new Set(rooms.map((room) => room?.id)).size).toBe(1)
  expect(rooms.every((room) => room?.n === 1)).toBe(true)
  expect(libraryRooms.map((room) => room.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
})
it("keeps existing source access beside a successful import without opening or selecting it", async () => {
  // Given
  const request = mount()
  // When
  await upload()
  // Then
  expect(window.location.pathname).toBe("/imports")
  expect(await screen.findByRole("heading", { name: "Your sources" })).toBeTruthy()
  expect(request.mock.calls.filter(([path]) => path === "/api/library-selection")).toHaveLength(0)
})
it("preserves the current study and receipt when the source switch is declined", async () => {
  // Given
  const request = mount()
  const confirm = vi.fn(() => false)
  vi.stubGlobal("confirm", confirm)
  const action = await upload()
  // When
  fireEvent.click(action)
  // Then
  await waitFor(() => expect(confirm).toHaveBeenCalledOnce())
  expect(window.location.pathname).toBe("/imports")
  expect(request.mock.calls.filter(([path]) => path === "/api/library-selection")).toHaveLength(0)
  expect(screen.getByRole("status").textContent).toContain("receipt-new")
})
it("opens the exact source with its matching study only after confirmation", async () => {
  // Given
  const request = mount()
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true),
  )
  const action = await upload()
  // When
  fireEvent.click(action)
  // Then
  expect(await screen.findByText("Only the newly imported source")).toBeTruthy()
  expect(window.location.pathname).toBe("/sources/rev-new")
  expect(screen.getByRole("heading", { name: imported.title })).toBeTruthy()
  expect(
    within(document.querySelector(".desk-foot") ?? document.body).getByText(
      `${imported.title} · ${imported.id}`,
    ),
  ).toBeTruthy()
  expect(request.mock.calls.filter(([path]) => path === "/api/imports/upload")).toHaveLength(1)
  expect(screen.getByRole("link", { name: "Read this book" })).toBeTruthy()
})
it("keeps a retryable receipt and sanitized alert when a confirmed switch fails", async () => {
  // Given
  const request = mount({ failSwitch: true })
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true),
  )
  const action = await upload()
  // When
  fireEvent.click(action)
  // Then
  const alert = await screen.findByRole("alert")
  expect(alert.textContent).not.toContain("/private/")
  expect(window.location.pathname).toBe("/imports")
  expect(screen.getByRole("link", { name: "Read this book" })).toBeTruthy()
  expect(screen.getByRole("status").textContent).toContain("receipt-new")
  expect(request.mock.calls.some(([path]) => path.startsWith("/api/source-reader"))).toBe(false)
})
it("does not offer reading for a queued receipt but keeps existing source access", async () => {
  // Given
  mount({ queued: true })
  const picker = await screen.findByLabelText(/Choose EPUB/)
  fireEvent.change(picker, {
    target: { files: { item: () => new File(["synthetic"], "new.txt") } },
  })
  // When
  fireEvent.submit(screen.getByRole("button", { name: "Import document" }))
  // Then
  expect((await screen.findByRole("status")).textContent).toContain("Not yet readable")
  expect(screen.queryByRole("link", { name: "Read this book" })).toBeNull()
  expect(await screen.findByRole("heading", { name: "Your sources" })).toBeTruthy()
})
