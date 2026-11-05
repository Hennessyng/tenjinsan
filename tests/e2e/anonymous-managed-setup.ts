import { expect } from "@playwright/test"
import { LocalSubscriptionSession, subscriptionDestination } from "@reading-studio/contracts"
import type { VerifiedRouteCapacity } from "@reading-studio/providers"
import { sourceViewerFixture } from "@reading-studio/server/source-viewer-fixture"
import type { Storage } from "@reading-studio/storage"
import { fenceLocalFixture } from "./anonymous-local.ts"

export const browserManagedChoice = { provider: "chatgpt-subscription", model: "study-model" }
const metadata = LocalSubscriptionSession.parse({
  status: "connected",
  generation: "00000000-0000-4000-8000-000000000001",
  connectionRevision: 0,
  billingRoute: "subscription-provider-managed",
  authUrl: null,
  expiresAt: null,
  catalog: "checked",
  account: { email: null, accountId: "synthetic-browser", workspaceId: null, planType: "fixture" },
  models: [{ model: browserManagedChoice.model, label: "Synthetic managed ChatGPT" }],
})
const destination = subscriptionDestination(
  "chatgpt-subscription",
  "browser-managed-installation",
  metadata,
)
if (!destination) throw new TypeError("Missing synthetic browser destination")
const capacity: VerifiedRouteCapacity = {
  id: "synthetic-browser-byte-tokens",
  evidenceScope: {
    kind: "synthetic-offline",
    measurement: "legacy-tool-input-pad-1",
    downstream: "unverified",
  },
  provider: "chatgpt-subscription",
  model: browserManagedChoice.model,
  destination,
  contextTokens: 100000,
  maxOutputTokens: 6000,
  maxRequestBytes: 32000,
  evidence: "Test-only UTF-8 byte grammar; not real ChatGPT capacity/transport proof",
  countInputTokens: (request) =>
    Buffer.byteLength(JSON.stringify([request.prompt, request.schema]), "utf8"),
}

export const browserManagedOptions = { serverHost: "127.0.0.1", bookMapCapacity: capacity }
export function attachBrowserManaged<
  F extends { readonly origin: string; readonly storage: Storage; close: () => Promise<void> },
>(input: F, options?: { readonly ownerId: string }) {
  const fixture = fenceLocalFixture(input)
  const ownerId =
    options?.ownerId ?? fixture.storage.sources.listStudiesByEdition("edition-fixture")[0]?.ownerId
  if (!ownerId) throw new TypeError("Missing owned browser study")
  fixture.storage.sources.createInstallation({
    id: "browser-managed-installation",
    ownerId,
  })
  let available = true
  let forbidden = 0
  fixture.storage.subscriptionLogin.status = () => metadata
  fixture.storage.subscriptionLogin.canDispatch = () => available
  fixture.storage.subscriptionLogin.profileBlocked = () => false
  fixture.storage.subscriptionLogin.refresh = async () => metadata
  fixture.storage.subscriptionLogin.connect = async () => {
    forbidden++
    throw new TypeError("Provider login forbidden")
  }
  fixture.storage.subscriptionLogin.withSession = async () => {
    forbidden++
    throw new TypeError("Browser feature fixture must not infer")
  }
  const close = fixture.close
  fixture.close = async () => {
    try {
      await close()
    } finally {
      expect(forbidden).toBe(0)
    }
  }
  return {
    ...fixture,
    setAvailable: (value: boolean) => {
      available = value
    },
  }
}
export async function anonymousManagedSetup() {
  return attachBrowserManaged(await sourceViewerFixture(browserManagedOptions))
}
