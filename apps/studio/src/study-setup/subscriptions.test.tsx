// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { LanguageProvider } from "../i18n/LanguageProvider.tsx"
import { SetupChoices as ChoicesSchema } from "./client.ts"
import { SetupChoices } from "./SetupChoices.tsx"

const value = ChoicesSchema.parse({
  normalization: {
    id: "normalization-a",
    editionId: "edition-a",
    editionHash: "a".repeat(64),
    parserVersion: "1",
    normalizerVersion: "1",
    coverage: "complete" as const,
    resources: [
      {
        path: "source.txt",
        role: "main-chapter" as const,
        status: "included" as const,
        blocks: [{ id: "block-a", text: "Synthetic source must stay local" }],
      },
    ],
  },
  choices: [
    { provider: "anthropic" as const, model: "claude-sonnet-4-6", label: "Existing Anthropic API" },
  ],
})
const providers = ["chatgpt-subscription", "claude-subscription", "grok-subscription"] as const
function snapshot(deployment: "local" | "hosted") {
  return {
    deployment,
    connections: providers.map((provider, index) => ({
      provider,
      route: ["sign-in-with-chatgpt", "claude-code-unmodified", "grok-build"][index],
      status: deployment === "local" ? "prerequisites-missing" : "local-only",
      connectionRevision: 0,
      canConnect: deployment === "local" && provider !== "claude-subscription",
      catalog: "not-checked",
      models: [],
      account: null,
      blockers: [
        "commercial-permission",
        "account-entitlement",
        "allowance-only",
        "tool-isolation",
        "live-proof",
      ],
    })),
  }
}
afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
})

it.each(["local", "hosted"] as const)(
  "offers only supported local authentication in %s Setup without hiding legacy choices",
  async (deployment) => {
    // Given
    const request = vi.fn(async (_path: string) => Response.json(snapshot(deployment)))
    vi.stubGlobal("fetch", request)
    const submit = vi.fn()
    // When
    render(
      <LanguageProvider>
        <SetupChoices value={value} onSubmit={submit} busy={false} />
      </LanguageProvider>,
    )
    // Then
    const panel = await screen.findByRole("region", {
      name: "Local subscription connections",
    })
    await waitFor(() =>
      expect(within(panel).getAllByRole("button", { name: /^Connect / })).toHaveLength(3),
    )
    expect(within(panel).getByRole("button", { name: "Connect ChatGPT" })).toHaveProperty(
      "disabled",
      deployment === "hosted",
    )
    expect(within(panel).getByRole("button", { name: "Connect Grok" })).toHaveProperty(
      "disabled",
      deployment === "hosted",
    )
    for (const provider of ["Claude"])
      expect(within(panel).getByRole("button", { name: `Connect ${provider}` })).toHaveProperty(
        "disabled",
        true,
      )
    expect(screen.getByRole("option", { name: "Existing Anthropic API" })).toBeDefined()
    expect(screen.getByRole("button", { name: "Connect Codex" })).toBeDefined()
    expect(submit).not.toHaveBeenCalled()
    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0]?.[0]).toBe("/api/subscription-connections")
  },
)

it("shows discovery failure rather than treating failure as an empty model catalog", async () => {
  // Given
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 503 })),
  )
  // When
  render(
    <LanguageProvider>
      <SetupChoices value={value} onSubmit={vi.fn()} busy={false} />
    </LanguageProvider>,
  )
  // Then
  expect((await screen.findByRole("alert")).getAttribute("data-subscription-error")).toBe(
    "discovery-failed",
  )
})

it("starts managed local sign-in without submitting source content", async () => {
  // Given
  const initial = snapshot("local")
  const pending = {
    ...initial,
    connections: initial.connections.map((connection) =>
      connection.provider === "chatgpt-subscription"
        ? {
            ...connection,
            status: "pending",
            authUrl: "https://auth.openai.com/authorize?state=synthetic",
            canConnect: false,
          }
        : connection,
    ),
  }
  const request = vi.fn(async (_path: string, options?: RequestInit) =>
    Response.json(options?.method === "POST" ? pending : initial),
  )
  vi.stubGlobal("fetch", request)
  const submit = vi.fn()
  render(
    <LanguageProvider>
      <SetupChoices value={value} onSubmit={submit} busy={false} />
    </LanguageProvider>,
  )
  const connect = await screen.findByRole("button", { name: "Connect ChatGPT" })
  // When
  fireEvent.click(connect)
  // Then
  expect(
    (await screen.findByRole("link", { name: "Continue official sign-in" })).getAttribute("href"),
  ).toBe("https://auth.openai.com/authorize?state=synthetic")
  expect(request).toHaveBeenCalledWith(
    "/api/subscription-connections/chatgpt-subscription/connect",
    expect.objectContaining({ method: "POST", body: "{}" }),
  )
  expect(submit).not.toHaveBeenCalled()
})

it("requires a new model selection when the selected connection disappears", async () => {
  // Given
  const initial = snapshot("local")
  const connected = {
    ...initial,
    connections: initial.connections.map((connection) =>
      connection.provider === "claude-subscription"
        ? connection
        : {
            ...connection,
            status: "connected",
            canConnect: false,
            canDispatch: true,
            catalog: "checked",
            models: [{ model: connection.provider, label: connection.provider }],
          },
    ),
  }
  const disconnected = {
    ...connected,
    connections: connected.connections.map((connection) =>
      connection.provider === "chatgpt-subscription"
        ? { ...connection, status: "disconnected", canDispatch: false, models: [] }
        : connection,
    ),
  }
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_path: string, options?: RequestInit) =>
      Response.json(options?.method === "POST" ? disconnected : connected),
    ),
  )
  render(
    <LanguageProvider>
      <SetupChoices value={value} onSubmit={vi.fn()} busy={false} />
    </LanguageProvider>,
  )
  const option = await screen.findByRole("option", {
    name: "chatgpt-subscription / chatgpt-subscription",
  })
  fireEvent.change(screen.getByRole("combobox", { name: "Provider and model" }), {
    target: { value: option.getAttribute("value") },
  })
  // When
  fireEvent.click(screen.getByRole("button", { name: "Disconnect local ChatGPT slot" }))
  // Then
  await waitFor(() =>
    expect(
      screen.queryByRole("option", { name: "chatgpt-subscription / chatgpt-subscription" }),
    ).toBeNull(),
  )
  expect(screen.getByRole("button", { name: "Review transmission" })).toHaveProperty(
    "disabled",
    true,
  )
})

it("refreshes prerequisite status without submitting source or signing in", async () => {
  // Given
  const request = vi.fn(async (_path: string) => Response.json(snapshot("local")))
  vi.stubGlobal("fetch", request)
  render(
    <LanguageProvider>
      <SetupChoices value={value} onSubmit={vi.fn()} busy={false} />
    </LanguageProvider>,
  )
  const refresh = await screen.findByRole("button", { name: "Refresh subscription prerequisites" })
  await waitFor(() => expect(refresh).toHaveProperty("disabled", false))
  // When
  fireEvent.click(refresh)
  // Then
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2))
  for (const call of request.mock.calls) expect(call[0]).toBe("/api/subscription-connections")
})
