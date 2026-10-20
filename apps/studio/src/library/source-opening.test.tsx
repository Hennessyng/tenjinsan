// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { LanguageProvider } from "../i18n/LanguageProvider.tsx"
import { useLibraryContext } from "./client.ts"
import { LibraryShell } from "./LibraryShell.tsx"
import { ReadSourceLink } from "./ReadSourceLink.tsx"

const study = {
  id: "study-a",
  title: "Repeated book",
  editionId: "edition-a",
  normalizationId: "same-source",
  normalizations: ["same-source"],
  setupId: null,
}
const duplicate = { ...study, id: "study-z" }
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
function mount() {
  history.replaceState(null, "", "/imports?lang=en")
  return render(
    <LanguageProvider>
      <ReadSourceLink revision="same-source">Read first</ReadSourceLink>
      <ReadSourceLink revision="other-source">Read other</ReadSourceLink>
    </LanguageProvider>,
  )
}
it.each([null, "another-study", duplicate.id])(
  "opens a duplicate source with a deterministic study when selection is %s",
  async (selectedStudyId) => {
    // Given
    const confirm = vi.fn(() => true)
    vi.stubGlobal("confirm", confirm)
    const request = vi.fn(async (path: string) =>
      path === "/api/library-context"
        ? Response.json({ studies: [duplicate, study], selectedStudyId })
        : Response.json({ selectedStudyId: study.id }),
    )
    vi.stubGlobal("fetch", request)
    mount()
    // When
    fireEvent.click(screen.getByRole("link", { name: "Read first" }))
    // Then
    await waitFor(() => expect(location.pathname).toBe("/sources/same-source"))
    if (selectedStudyId === duplicate.id) {
      expect(request).toHaveBeenCalledTimes(1)
      expect(confirm).not.toHaveBeenCalled()
    } else {
      expect(request).toHaveBeenCalledWith(
        "/api/library-selection",
        expect.objectContaining({ body: JSON.stringify({ studyId: study.id }) }),
      )
      expect(confirm).toHaveBeenCalledTimes(selectedStudyId === null ? 0 : 1)
    }
  },
)
it("does not select or navigate after its source link unmounts during lookup", async () => {
  // Given
  let finish: (response: Response) => void = () => undefined
  const request = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve
      }),
  )
  vi.stubGlobal("fetch", request)
  const view = mount()
  fireEvent.click(screen.getByRole("link", { name: "Read first" }))
  // When
  view.unmount()
  await act(async () => {
    finish(Response.json({ studies: [study], selectedStudyId: null }))
  })
  // Then
  expect(location.pathname).toBe("/imports")
  expect(request).toHaveBeenCalledTimes(1)
})
it("serializes competing source links while a selection request is in flight", async () => {
  // Given
  let finish: (response: Response) => void = () => undefined
  const request = vi.fn((path: string) =>
    path === "/api/library-context"
      ? Promise.resolve(Response.json({ studies: [study], selectedStudyId: null }))
      : new Promise<Response>((resolve) => {
          finish = resolve
        }),
  )
  vi.stubGlobal("fetch", request)
  mount()
  fireEvent.click(screen.getByRole("link", { name: "Read first" }))
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2))
  // When
  fireEvent.click(screen.getByRole("link", { name: "Read other" }))
  await act(async () => {
    finish(Response.json({ selectedStudyId: study.id }))
  })
  // Then
  expect(request).toHaveBeenCalledTimes(2)
  expect(location.pathname).toBe("/sources/same-source")
})

function Identity() {
  const { context, ready } = useLibraryContext("identity")
  return (
    <output aria-label="Study identity" data-ready={ready}>
      {context?.selectedStudyId ?? "loading"}
    </output>
  )
}
it("aborts an in-flight selection and does not navigate after unmount", async () => {
  // Given
  let finish: (response: Response) => void = () => undefined
  let signal: AbortSignal | null | undefined
  const request = vi.fn((path: string, options?: RequestInit) => {
    if (path === "/api/library-context")
      return Promise.resolve(Response.json({ studies: [study], selectedStudyId: null }))
    signal = options?.signal
    return new Promise<Response>((resolve) => {
      finish = resolve
    })
  })
  vi.stubGlobal("fetch", request)
  const view = mount()
  fireEvent.click(screen.getByRole("link", { name: "Read first" }))
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2))
  // When
  view.unmount()
  await act(async () => {
    finish(Response.json({ selectedStudyId: study.id }))
  })
  // Then
  expect(signal?.aborted).toBe(true)
  expect(location.pathname).toBe("/imports")
})
it("adopts the matching study identity without waiting for a post-navigation refetch", async () => {
  // Given
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true),
  )
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) =>
      path === "/api/library-context"
        ? Response.json({ studies: [study], selectedStudyId: "other-study" })
        : Response.json({ selectedStudyId: study.id }),
    ),
  )
  history.replaceState(null, "", "/imports")
  render(
    <LanguageProvider>
      <Identity />
      <ReadSourceLink revision="same-source">Read</ReadSourceLink>
    </LanguageProvider>,
  )
  await screen.findByText("other-study")
  // When
  fireEvent.click(screen.getByRole("link", { name: "Read" }))
  // Then
  await waitFor(() => expect(location.pathname).toBe("/sources/same-source"))
  expect(screen.getByLabelText("Study identity").textContent).toBe(study.id)
  expect(screen.getByLabelText("Study identity").getAttribute("data-ready")).toBe("true")
})
it("withholds a duplicate source when an unrelated study is selected on a direct URL", async () => {
  // Given
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        studies: [
          study,
          duplicate,
          {
            ...study,
            id: "other",
            normalizations: ["other-source"],
            normalizationId: "other-source",
          },
        ],
        selectedStudyId: "other",
      }),
    ),
  )
  history.replaceState(null, "", "/sources/same-source?lang=en")
  const root = document.createElement("div")
  root.id = "root"
  document.body.replaceChildren(root)
  // When
  render(
    <LanguageProvider>
      <LibraryShell>{() => <p>Source content</p>}</LibraryShell>
    </LanguageProvider>,
    { container: root },
  )
  // Then
  await screen.findByRole("button", { name: "Choose linked study" })
  expect(screen.queryByText("Source content")).toBeNull()
})
