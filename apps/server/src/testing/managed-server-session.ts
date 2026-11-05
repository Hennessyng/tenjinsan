import { LocalSubscriptionSession, subscriptionDestination } from "@reading-studio/contracts"
import type { VerifiedRouteCapacity } from "@reading-studio/providers"
import type { Storage } from "@reading-studio/storage"
import { expect, vi } from "vitest"

export const managedServerChoice = { provider: "chatgpt-subscription", model: "study-model" }

export function managedServerSession(storage: Storage, ownerId: string, origin: string) {
  const installationId =
    storage.sources.getInstallation(ownerId) ??
    storage.sources.createInstallation({ id: "managed-server-installation", ownerId })
  const metadata = LocalSubscriptionSession.parse({
    status: "connected",
    generation: "00000000-0000-4000-8000-000000000001",
    connectionRevision: 0,
    billingRoute: "subscription-provider-managed",
    authUrl: null,
    expiresAt: null,
    catalog: "checked",
    account: { email: null, accountId: "synthetic-server", planType: "fixture", workspaceId: null },
    models: [{ model: managedServerChoice.model, label: "Synthetic managed model" }],
  })
  const status = vi.spyOn(storage.subscriptionLogin, "status").mockReturnValue(metadata)
  const canDispatch = vi.spyOn(storage.subscriptionLogin, "canDispatch").mockReturnValue(true)
  vi.spyOn(storage.subscriptionLogin, "profileBlocked").mockReturnValue(false)
  const refresh = vi.spyOn(storage.subscriptionLogin, "refresh").mockResolvedValue(metadata)
  const connect = vi
    .spyOn(storage.subscriptionLogin, "connect")
    .mockRejectedValue(new TypeError("New login forbidden"))
  const session = vi
    .spyOn(storage.subscriptionLogin, "withSession")
    .mockRejectedValue(new TypeError("Server preparation must not dispatch"))
  const destination = subscriptionDestination("chatgpt-subscription", installationId, metadata)
  if (!destination) throw new TypeError("Missing synthetic destination")
  const capacity: VerifiedRouteCapacity = {
    id: "synthetic-server-chatgpt-byte-tokens-v1",
    provider: "chatgpt-subscription",
    model: managedServerChoice.model,
    destination,
    contextTokens: 100000,
    maxOutputTokens: 6000,
    maxRequestBytes: 32000,
    evidence: "Test-only UTF-8 byte tokens, not production ChatGPT capacity or transport evidence",
    evidenceScope: {
      kind: "synthetic-offline",
      measurement: "legacy-tool-input-pad-1",
      downstream: "unverified",
    },
    countInputTokens: (request) =>
      Buffer.byteLength(JSON.stringify([request.prompt, request.schema]), "utf8"),
  }
  const nativeFetch = globalThis.fetch
  const external = vi.fn(() => {
    throw new TypeError("External network forbidden")
  })
  vi.stubGlobal("fetch", (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url)
    if (url.origin !== origin) return external()
    return nativeFetch(input, init)
  })
  return {
    metadata,
    capacity,
    status,
    canDispatch,
    refresh,
    connect,
    session,
    external,
    assertOffline() {
      try {
        expect(external).not.toHaveBeenCalled()
        expect(connect).not.toHaveBeenCalled()
        expect(session).not.toHaveBeenCalled()
      } finally {
        vi.restoreAllMocks()
        vi.unstubAllGlobals()
        vi.unstubAllEnvs()
      }
    },
  }
}
