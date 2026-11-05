import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import {
  type Job,
  LocalSubscriptionSession,
  subscriptionDestination,
} from "@reading-studio/contracts"
import {
  LocalSubscriptionAdapter,
  type ProviderAuthority,
  type ProviderReceipt,
  type StructuredRequest,
  type VerifiedRouteCapacity,
} from "@reading-studio/providers"
import type { Storage } from "@reading-studio/storage"
import { vi } from "vitest"
import { attachManagedSession } from "./managed-session-fixture.ts"

const metadata = LocalSubscriptionSession.parse({
  status: "connected",
  generation: "00000000-0000-4000-8000-000000000001",
  connectionRevision: 0,
  billingRoute: "subscription-provider-managed",
  authUrl: null,
  expiresAt: null,
  catalog: "checked",
  account: { email: null, accountId: "synthetic-book-map", planType: "fixture", workspaceId: null },
  models: [{ model: "study-model", label: "Synthetic managed model" }],
})
const destination = subscriptionDestination("chatgpt-subscription", "installation-1", metadata)
if (!destination) throw new TypeError("Missing synthetic book route")
export const bookFixtureCapacity: VerifiedRouteCapacity = {
  id: "synthetic-capacity-v1",
  provider: "chatgpt-subscription",
  model: "study-model",
  destination,
  contextTokens: 100000,
  maxOutputTokens: 6000,
  maxRequestBytes: 32000,
  evidence: "Test-only UTF-8 byte tokens, not production ChatGPT capacity/transport evidence",
  evidenceScope: {
    kind: "synthetic-offline",
    measurement: "legacy-tool-input-pad-1",
    downstream: "unverified",
  },
  countInputTokens: (request) =>
    Buffer.byteLength(JSON.stringify([request.prompt, request.schema]), "utf8"),
}
type Fixture = { readonly directory: string; readonly storage: Storage }
const routes = new WeakMap<Storage, ReturnType<typeof attachManagedSession>>()
export function bookFixtureAuthority(
  fixture: Fixture,
  capacity = bookFixtureCapacity,
): ProviderAuthority {
  if (!routes.has(fixture.storage)) {
    const home = join(fixture.directory, "empty-owned-profile")
    const control = join(fixture.directory, "managed-control")
    mkdirSync(home, { recursive: true })
    mkdirSync(control, { recursive: true })
    const binary = join(fixture.directory, "fake-app-server")
    writeFileSync(
      binary,
      `#!/bin/sh\nexec "${process.execPath}" "${resolve("apps/worker/tests/managed-workflow-rpc.cjs")}" "control:${control}" "$@"\n`,
      { mode: 0o700 },
    )
    vi.stubEnv("STUDIO_SUBSCRIPTION_CODEX_BINARY", binary)
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new TypeError("External network forbidden")
      }),
    )
    routes.set(fixture.storage, attachManagedSession(fixture.storage, { home, metadata }))
  }
  return {
    storage: fixture.storage,
    ownerId: "owner-1",
    installationId: "installation-1",
    localSubscriptions: true,
    capacity,
  }
}
export function bookFixtureProvider(input: {
  readonly fixture: Fixture
  readonly authority: ProviderAuthority
  readonly job: Job
  readonly authored: { dispatch(request: StructuredRequest): Promise<ProviderReceipt> }
}) {
  const native = new LocalSubscriptionAdapter(input.authority, input.job)
  return {
    measure: (request: StructuredRequest) => native.measure(request),
    dispatch: async (request: StructuredRequest) => {
      const reply = await input.authored.dispatch(request)
      if (reply.kind !== "output") throw new TypeError("Unexpected managed reply author failure")
      const output: unknown = JSON.parse(reply.text)
      const control = join(input.fixture.directory, "managed-control")
      writeFileSync(join(control, "responses.json"), JSON.stringify([output]))
      writeFileSync(join(control, "cursor"), "0")
      return native.dispatch(request)
    },
  }
}
export function bookFixtureTurns(fixture: Fixture): readonly unknown[] {
  try {
    return readFileSync(join(fixture.directory, "managed-control", "requests.jsonl"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line): unknown => JSON.parse(line))
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return []
    throw error
  }
}
export async function closeBookRoute(storage: Storage) {
  await routes.get(storage)?.close()
  routes.delete(storage)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
}
