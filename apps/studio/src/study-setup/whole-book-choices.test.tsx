// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { LanguageProvider } from "../i18n/LanguageProvider.tsx"
import { SetupChoices as ChoicesSchema } from "./client.ts"
import { SetupChoices } from "./SetupChoices.tsx"
import { SetupRoutes } from "./SetupRoutes.tsx"

const included = (path: string, role: "main-chapter" | "supplementary", text: string) => ({
  path,
  role,
  status: "included" as const,
  blocks: [{ id: `block-${path.replace(/\W/g, "-")}`, text }],
})
const normalization = (resources: readonly unknown[], coverage: "complete" | "partial") => ({
  id: "normalization-a",
  editionId: "edition-a",
  editionHash: "a".repeat(64),
  parserVersion: "1",
  normalizerVersion: "1",
  coverage,
  resources,
})
const choice = { provider: "anthropic" as const, model: "synthetic", label: "Synthetic model" }
const value = (resources: readonly unknown[], coverage: "complete" | "partial" = "complete") =>
  ChoicesSchema.parse({ normalization: normalization(resources, coverage), choices: [choice] })
const connections = () => Response.json({ deployment: "local", connections: [] })
afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
})
function show(
  resources: readonly unknown[],
  coverage: "complete" | "partial" = "complete",
  onSubmit = vi.fn(),
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => connections()),
  )
  render(
    <LanguageProvider>
      <SetupChoices value={value(resources, coverage)} onSubmit={onSubmit} busy={false} />
    </LanguageProvider>,
  )
  return onSubmit
}

it("offers no scope, main-chapter or chapter controls and lists every included resource", async () => {
  // Given / When
  show([
    included("chapter.xhtml", "main-chapter", "Main text"),
    included("notes.xhtml", "supplementary", "Supplementary text"),
  ])
  // Then
  await screen.findByRole("button", { name: "Review transmission" })
  expect(screen.queryAllByRole("radio")).toHaveLength(0)
  expect(screen.queryAllByRole("checkbox")).toHaveLength(0)
  expect(screen.queryByText(/Choose specific chapters|All main chapters|Source scope/)).toBeNull()
  expect(screen.getByText(/chapter\.xhtml · 1 blocks/)).toBeDefined()
  expect(screen.getByText(/notes\.xhtml · 1 blocks/)).toBeDefined()
  expect(screen.getByText(/every extracted resource and block/)).toBeDefined()
})

it("submits only the provider and model, with no scope decision", async () => {
  // Given
  const onSubmit = show([included("chapter.xhtml", "main-chapter", "Main text")])
  // When
  fireEvent.click(await screen.findByRole("button", { name: "Review transmission" }))
  // Then
  expect(onSubmit).toHaveBeenCalledTimes(1)
  expect(onSubmit).toHaveBeenCalledWith({ provider: "anthropic", model: "synthetic" })
})

it("discloses omitted parts honestly and needs no extra acknowledgement to continue", async () => {
  // Given: partial extraction with one omitted resource
  const onSubmit = show(
    [
      included("chapter.xhtml", "main-chapter", "Main text"),
      {
        path: "plate.xhtml",
        role: "supplementary",
        status: "excluded",
        reason: "unsupported-media",
      },
    ],
    "partial",
  )
  // When
  const button = await screen.findByRole("button", { name: "Review transmission" })
  // Then: the omission is visible, not hidden, and nothing extra must be ticked
  expect(screen.getByText(/could not be extracted/)).toBeDefined()
  expect(screen.getByText("Unavailable: plate.xhtml (unsupported-media)")).toBeDefined()
  expect(screen.queryAllByRole("checkbox")).toHaveLength(0)
  expect(button).toHaveProperty("disabled", false)
  fireEvent.click(button)
  expect(onSubmit).toHaveBeenCalledWith({ provider: "anthropic", model: "synthetic" })
})

it.each([
  [
    "only omitted resources",
    [{ path: "scan.xhtml", role: "main-chapter", status: "excluded", reason: "textless" }],
  ],
  ["only textless blocks", [included("anchors.xhtml", "main-chapter", "")]],
])("cannot continue from an empty extraction with %s", async (_name, resources) => {
  // Given / When
  const onSubmit = show(resources, "partial")
  // Then
  const button = await screen.findByRole("button", { name: "Review transmission" })
  expect(screen.getByText(/No text could be extracted/)).toBeDefined()
  expect(button).toHaveProperty("disabled", true)
  fireEvent.click(button)
  expect(onSubmit).not.toHaveBeenCalled()
})

it("explains an empty-extraction refusal from the server without chapter-selection advice", async () => {
  // Given
  history.replaceState(null, "", "/sources/normalization-a/setup")
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, options?: RequestInit) => {
      if (path.startsWith("/api/subscription-connections")) return connections()
      return options?.method === "POST"
        ? Response.json({ error: "No extracted text" }, { status: 422 })
        : Response.json({
            normalization: normalization(
              [included("chapter.xhtml", "main-chapter", "Text")],
              "complete",
            ),
            choices: [choice],
          })
    }),
  )
  render(
    <LanguageProvider>
      <SetupRoutes />
    </LanguageProvider>,
  )
  // When
  fireEvent.click(await screen.findByRole("button", { name: "Review transmission" }))
  // Then
  const alert = await screen.findByRole("alert")
  expect(alert.textContent).toContain("No text could be extracted")
  expect(alert.textContent).not.toMatch(/chapter/i)
})
