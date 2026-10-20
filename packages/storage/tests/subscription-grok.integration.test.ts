import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { openStorage, type Storage } from "../src/index.ts"

const resources: { readonly directory: string; readonly stores: Storage[] }[] = []
const network = vi.fn(async () => {
  throw new TypeError("Network forbidden")
})
beforeEach(() => {
  network.mockClear()
  vi.stubGlobal("fetch", network)
})
afterEach(async () => {
  for (const { directory, stores } of resources.splice(0)) {
    for (const storage of stores) storage.close()
    await rm(directory, { recursive: true, force: true })
  }
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})
async function fixture(scenario = "success") {
  const directory = await mkdtemp(join(tmpdir(), "ten21-grok-"))
  const binary = join(directory, "grok-fixture")
  await writeFile(
    binary,
    `#!/bin/sh\nexec "${process.execPath}" "${resolve("packages/storage/tests/subscription-grok-fixture.cjs")}" "fixture:${scenario}" "$@"\n`,
  )
  await chmod(binary, 0o700)
  vi.stubEnv("STUDIO_SUBSCRIPTION_GROK_BINARY", binary)
  const options = {
    databasePath: join(directory, "studio.sqlite"),
    privateDataRoot: join(directory, "private"),
  }
  const storage = openStorage(options)
  const second = openStorage(options)
  resources.push({ directory, stores: [storage, second] })
  const installationId = storage.sources.createInstallation({
    id: "installation-grok",
    ownerId: storage.libraryOwnerId(),
  })
  return { storage, second, installationId }
}
it("uses official Grok ACP login and resumes tool-owned OAuth without API fallback", async () => {
  // Given
  const { storage, second, installationId } = await fixture()
  // When
  const pending = await storage.grokSubscriptionLogin.connect(installationId)
  await storage.grokSubscriptionLogin.settled(installationId)
  const resumed = await second.grokSubscriptionLogin.refresh(installationId)
  // Then
  expect(pending.authUrl).toMatch(/^https:\/\/auth.x.ai\//)
  expect(resumed.connectionRevision).toBe(pending.connectionRevision)
  expect(resumed).toMatchObject({
    status: "connected",
    billingRoute: "subscription-provider-managed",
    account: { accountId: "user-fixture", email: "grok@example.test", workspaceId: null },
    models: [{ model: "offered-grok", label: "Grok offered model" }],
  })
  expect(storage.subscriptionLogin.status(installationId).status).toBe("disconnected")
  expect(network).not.toHaveBeenCalled()
})
it("invalidates prior destination consent when Grok's principal changes on refresh", async () => {
  // Given
  const { storage, second, installationId } = await fixture("changed-account")
  const pending = await storage.grokSubscriptionLogin.connect(installationId)
  await storage.grokSubscriptionLogin.settled(installationId)
  // When
  const refreshed = await second.grokSubscriptionLogin.refresh(installationId)
  // Then
  expect(refreshed.account?.accountId).toBe("user-other")
  expect(refreshed.connectionRevision).toBeGreaterThan(pending.connectionRevision)
  expect(network).not.toHaveBeenCalled()
})
it("rejects a failed ACP authentication result instead of trusting the local token marker", async () => {
  // Given
  const { storage, installationId } = await fixture("denied")
  // When
  await storage.grokSubscriptionLogin.connect(installationId)
  await storage.grokSubscriptionLogin.settled(installationId)
  // Then
  expect(storage.grokSubscriptionLogin.status(installationId)).toMatchObject({
    status: "error",
    account: null,
    models: [],
  })
  expect(network).not.toHaveBeenCalled()
})
it("disconnects pending Grok login from another API instance without reviving it", async () => {
  // Given
  const { storage, second, installationId } = await fixture("pending")
  await storage.grokSubscriptionLogin.connect(installationId)
  // When
  await second.grokSubscriptionLogin.disconnect(installationId)
  // Then
  await storage.grokSubscriptionLogin.settled(installationId)
  expect(storage.grokSubscriptionLogin.status(installationId)).toMatchObject({
    status: "disconnected",
    authUrl: null,
    models: [],
  })
  expect(network).not.toHaveBeenCalled()
})

it("rejects an API-key auth mode even when the tool answers a cached-token request", async () => {
  // Given
  const { storage, installationId } = await fixture("api-mode")
  // When
  await storage.grokSubscriptionLogin.connect(installationId)
  await storage.grokSubscriptionLogin.settled(installationId)
  // Then
  expect(storage.grokSubscriptionLogin.status(installationId).status).toBe("error")
  expect(network).not.toHaveBeenCalled()
})
