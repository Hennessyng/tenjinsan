import { access, chmod, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, relative, resolve } from "node:path"
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
  vi.restoreAllMocks()
  vi.useRealTimers()
})
async function fixture(scenario = "success") {
  const directory = await mkdtemp(join(tmpdir(), "ten21-login-"))
  const binary = join(directory, "codex-fixture")
  await writeFile(
    binary,
    `#!/bin/sh\nexec "${process.execPath}" "${resolve("packages/storage/tests/subscription-codex-fixture.cjs")}" "fixture:${scenario}" "$@"\n`,
  )
  await chmod(binary, 0o700)
  vi.stubEnv("STUDIO_SUBSCRIPTION_CODEX_BINARY", binary)
  const options = {
    databasePath: join(directory, "studio.sqlite"),
    privateDataRoot: join(directory, "private"),
  }
  const storage = openStorage(options)
  const second = openStorage(options)
  const resource = { directory, stores: [storage, second] }
  resources.push(resource)
  const ownerId = storage.libraryOwnerId()
  const installationId = storage.sources.createInstallation({ id: "installation-one", ownerId })
  return { storage, second, installationId, directory }
}

it("completes correlated official login and refreshes persisted account models from another instance", async () => {
  // Given
  const { storage, second, installationId } = await fixture()
  // When
  const pending = await storage.subscriptionLogin.connect(installationId)
  await storage.subscriptionLogin.settled(installationId)
  const refreshed = await second.subscriptionLogin.refresh(installationId)
  // Then
  expect(pending.status).toBe("pending")
  expect(pending.authUrl).toMatch(/^https:\/\/auth.openai.com\//)
  expect(refreshed).toMatchObject({
    status: "connected",
    billingRoute: "subscription-provider-managed",
    account: { email: "fixture@example.test", workspaceId: "workspace-fixture" },
    models: [{ model: "offered/model", label: "Account model" }],
    catalog: "checked",
  })
  expect(network).not.toHaveBeenCalled()
})

it.each(["wrong-id", "failed"])(
  "does not authorize when login completion is %s",
  async (scenario) => {
    // Given
    const { storage, installationId } = await fixture(scenario)
    // When
    await storage.subscriptionLogin.connect(installationId)
    if (scenario === "failed") await storage.subscriptionLogin.settled(installationId)
    // Then
    expect(storage.subscriptionLogin.status(installationId).status).not.toBe("connected")
    expect(storage.subscriptionLogin.status(installationId).models).toEqual([])
    expect(network).not.toHaveBeenCalled()
  },
)

it("fences a pending login across instances so late completion cannot reconnect", async () => {
  // Given
  const { storage, second, installationId } = await fixture("wrong-id")
  const pending = await storage.subscriptionLogin.connect(installationId)
  // When
  await second.subscriptionLogin.disconnect(installationId)
  // Then
  expect(storage.subscriptionLogin.status(installationId)).toMatchObject({
    status: "disconnected",
    models: [],
  })
  expect(
    storage.subscriptionConnections.revision(installationId, "chatgpt-subscription"),
  ).toBeGreaterThan(pending.connectionRevision)
  await expect(second.subscriptionLogin.refresh(installationId)).resolves.toMatchObject({
    status: "disconnected",
  })
  expect(network).not.toHaveBeenCalled()
})

it("rejects duplicate pending login from another instance", async () => {
  // Given
  const { storage, second, installationId } = await fixture("wrong-id")
  await storage.subscriptionLogin.connect(installationId)
  // When / Then
  await expect(second.subscriptionLogin.connect(installationId)).rejects.toMatchObject({
    code: "connection-busy",
  })
  expect(network).not.toHaveBeenCalled()
})

it("requires new consent when a refreshed workspace changes", async () => {
  // Given
  const { storage, second, installationId } = await fixture("changed-workspace")
  const pending = await storage.subscriptionLogin.connect(installationId)
  await storage.subscriptionLogin.settled(installationId)
  // When
  const changed = await second.subscriptionLogin.refresh(installationId)
  // Then
  expect(changed.account?.workspaceId).toBe("workspace-other")
  expect(changed.connectionRevision).toBeGreaterThan(pending.connectionRevision)
  expect(network).not.toHaveBeenCalled()
})

it("reports interrupted pending sign-in as expired instead of waiting forever after restart", async () => {
  // Given
  const { storage, second, installationId } = await fixture("wrong-id")
  await storage.subscriptionLogin.connect(installationId)
  storage.subscriptionLogin.close()
  await storage.subscriptionLogin.settled(installationId)
  // When
  const state = second.subscriptionLogin.status(installationId)
  // Then
  expect(state).toMatchObject({ status: "expired", authUrl: null, models: [] })
  expect(network).not.toHaveBeenCalled()
})

it("removes stale offered models when official refresh reports a signed-out account", async () => {
  // Given
  const { storage, second, installationId } = await fixture("expired")
  await storage.subscriptionLogin.connect(installationId)
  await storage.subscriptionLogin.settled(installationId)
  // When
  const refreshed = await second.subscriptionLogin.refresh(installationId)
  // Then
  expect(refreshed).toMatchObject({
    status: "expired",
    account: null,
    models: [],
    catalog: "failed",
  })
  expect(network).not.toHaveBeenCalled()
})

it("prevents an in-flight refresh from restoring a concurrently disconnected session", async () => {
  // Given
  const { storage, second, installationId } = await fixture()
  await storage.subscriptionLogin.connect(installationId)
  await storage.subscriptionLogin.settled(installationId)
  const refreshing = storage.subscriptionLogin.refresh(installationId)
  // When
  await second.subscriptionLogin.disconnect(installationId)
  // Then
  expect(await refreshing).toMatchObject({ status: "disconnected", account: null, models: [] })
  expect(second.subscriptionLogin.status(installationId).status).toBe("disconnected")
  expect(network).not.toHaveBeenCalled()
})

it("surfaces missing executable without attempting fallback authentication", async () => {
  // Given
  const { storage, installationId } = await fixture()
  vi.stubEnv("STUDIO_SUBSCRIPTION_CODEX_BINARY", "/nonexistent/ten21-codex")
  // When / Then
  await expect(storage.subscriptionLogin.connect(installationId)).rejects.toMatchObject({
    code: "tool-unavailable",
  })
  expect(storage.subscriptionLogin.status(installationId).status).toBe("error")
  expect(network).not.toHaveBeenCalled()
})

it("runs each tool outside the library tree and removes its scratch workspace after completion", async () => {
  // Given
  const { storage, installationId, directory } = await fixture()
  await storage.subscriptionLogin.connect(installationId)
  await storage.subscriptionLogin.settled(installationId)
  // When
  const workspace = await storage.subscriptionLogin.withSession(
    installationId,
    async (session) => session.rpc.cwd,
  )
  // Then
  expect(relative(directory, workspace).startsWith("..")).toBe(true)
  await expect(access(workspace)).rejects.toMatchObject({ code: "ENOENT" })
  expect(network).not.toHaveBeenCalled()
})

it.each([
  { elapsedMinutes: 6, expected: "pending" },
  { elapsedMinutes: 11, expected: "error" },
])(
  "retains the official managed-login window after $elapsedMinutes minutes",
  async ({ elapsedMinutes, expected }) => {
    // Given
    const { storage, second, installationId } = await fixture("wrong-id")
    const started = Date.now()
    const clock = vi.spyOn(Date, "now").mockReturnValue(started)
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })
    const pending = await storage.subscriptionLogin.connect(installationId)
    try {
      // When
      clock.mockReturnValue(started + elapsedMinutes * 60000)
      await vi.advanceTimersByTimeAsync(100)
      // Then
      const observed = second.subscriptionLogin.status(installationId)
      expect(observed.status).toBe(expected)
      if (expected === "pending") {
        expect(observed.authUrl === pending.authUrl).toBe(true)
        await expect(second.subscriptionLogin.connect(installationId)).rejects.toMatchObject({
          code: "connection-busy",
        })
        expect(second.subscriptionLogin.status(installationId).authUrl === pending.authUrl).toBe(
          true,
        )
      }
      expect(network).not.toHaveBeenCalled()
    } finally {
      storage.subscriptionLogin.close()
      await storage.subscriptionLogin.settled(installationId)
      vi.useRealTimers()
    }
  },
)
