import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openStorage, type Storage } from "@reading-studio/storage"
import { afterEach, expect, it, vi } from "vitest"
import { createApp } from "./app.ts"

const resources: { directory: string; stores: Storage[] }[] = []
afterEach(async () => {
  vi.unstubAllGlobals()
  for (const resource of resources.splice(0)) {
    for (const store of resource.stores) store.close()
    await rm(resource.directory, { recursive: true, force: true })
  }
})
async function fixture(host = "127.0.0.1", origin = "http://127.0.0.1:8787") {
  const directory = await mkdtemp(join(tmpdir(), "ten21-"))
  const options = {
    databasePath: join(directory, "studio.sqlite"),
    privateDataRoot: join(directory, "private"),
  }
  const storage = openStorage(options)
  const resource = { directory, stores: [storage] }
  resources.push(resource)
  const dependencies = {
    serverHost: host,
    reviewStorage: storage,
    libraryOwnerId: storage.libraryOwnerId(),
    sources: storage.sources,
    security: {
      trustedOrigins: [origin],
      trustProxy: false,
      apiBodyBytes: 4096,
      loginBodyBytes: 4096,
      loginRateLimit: { attempts: 5, windowMs: 60000 },
      uploadBodyBytes: 8192,
    },
  }
  return { app: createApp(dependencies), origin, dependencies, options, resource }
}

it("offers local ChatGPT login independently of dispatch verification without contacting a provider", async () => {
  // Given
  const { app, origin } = await fixture()
  const network = vi.fn(() => {
    throw new TypeError("External network forbidden")
  })
  vi.stubGlobal("fetch", network)
  // When
  const response = await app.request(`${origin}/api/subscription-connections`)
  // Then
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({
    deployment: "local",
    connections: [
      {
        provider: "chatgpt-subscription",
        status: "disconnected",
        models: [],
        catalog: "not-checked",
        canConnect: true,
        canDispatch: false,
        billingRoute: "subscription-provider-managed",
      },
      {
        provider: "claude-subscription",
        status: "prerequisites-missing",
        models: [],
        catalog: "not-checked",
        canConnect: false,
      },
      {
        provider: "grok-subscription",
        status: "disconnected",
        models: [],
        catalog: "not-checked",
        canConnect: true,
      },
    ],
  })
  expect(network).not.toHaveBeenCalled()
})

it.each([
  ["0.0.0.0", "http://127.0.0.1:8787"],
  ["127.0.0.1", "https://studio.example.test"],
])("refuses subscription controls on hosted or exposed listeners: %s", async (host, origin) => {
  // Given
  const { app } = await fixture(host, origin)
  // When
  const response = await app.request(
    `${origin}/api/subscription-connections/chatgpt-subscription/connect`,
    {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: "{}",
    },
  )
  // Then
  expect(response.status).toBe(403)
  expect(await response.json()).toMatchObject({ error: "local-only" })
})

it("refuses fabricated eligibility or credentials without creating consent", async () => {
  // Given
  const { app, origin, dependencies } = await fixture()
  // When
  const response = await app.request(
    `${origin}/api/subscription-connections/chatgpt-subscription/connect`,
    {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ verified: true, accessToken: "synthetic-secret" }),
    },
  )
  // Then
  expect(response.status).toBe(400)
  expect(await response.json()).toMatchObject({
    error: "invalid-connection-request",
    transmission: "not-sent",
  })
  expect(dependencies.reviewStorage.counts().grants).toBe(0)
})

it("persists disconnection fencing across API instances without changing sibling routes", async () => {
  // Given
  const { app, origin, dependencies, options, resource } = await fixture()
  const second = openStorage(options)
  resource.stores.push(second)
  const other = createApp({ ...dependencies, reviewStorage: second })
  // When
  const disconnected = await app.request(
    `${origin}/api/subscription-connections/claude-subscription/disconnect`,
    {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: "{}",
    },
  )
  // Then
  expect(disconnected.status).toBe(200)
  const snapshot = await other.request(`${origin}/api/subscription-connections`)
  expect(await snapshot.json()).toMatchObject({
    connections: [
      { provider: "chatgpt-subscription", connectionRevision: 0 },
      { provider: "claude-subscription", connectionRevision: 1, status: "disconnected" },
      { provider: "grok-subscription", connectionRevision: 0 },
    ],
  })
})

it("rejects forwarded requests rather than exposing loopback controls through a proxy", async () => {
  // Given
  const { app, origin } = await fixture()
  // When
  const response = await app.request(
    `${origin}/api/subscription-connections/grok-subscription/disconnect`,
    {
      method: "POST",
      headers: { origin, "content-type": "application/json", "x-forwarded-for": "192.0.2.1" },
      body: "{}",
    },
  )
  // Then
  expect(response.status).toBe(403)
})

it("returns local-only diagnostics behind a hosted proxy without enabling controls", async () => {
  // Given
  const { app, origin } = await fixture("0.0.0.0", "https://studio.example.test")
  // When
  const response = await app.request(`${origin}/api/subscription-connections`, {
    headers: { "x-forwarded-for": "192.0.2.1" },
  })
  // Then
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({
    deployment: "hosted",
    connections: [
      { status: "local-only", canConnect: false },
      { status: "local-only", canConnect: false },
      { status: "local-only", canConnect: false },
    ],
  })
})

it("rejects a subscription draft before discovery or creating a grant", async () => {
  // Given
  const { app, origin, dependencies } = await fixture()
  const ownerId = dependencies.libraryOwnerId
  dependencies.sources.persistDocument({
    edition: {
      id: "edition-a",
      originalHash: "a".repeat(64),
      originalBlobHash: "a".repeat(64),
      title: "Synthetic",
    },
    normalization: {
      id: "normalization-a",
      editionId: "edition-a",
      editionHash: "a".repeat(64),
      parserVersion: "1",
      normalizerVersion: "1",
      coverage: "complete",
      resources: [
        {
          path: "source.txt",
          role: "main-chapter",
          status: "included",
          blocks: [{ id: "block-a", text: "Synthetic text" }],
        },
      ],
    },
  })
  dependencies.sources.createStudy({ id: "study-a", editionId: "edition-a", ownerId })
  const network = vi.fn(async () => {
    throw new TypeError("External network forbidden")
  })
  vi.stubGlobal("fetch", network)
  // When
  const response = await app.request(`${origin}/api/study-setup/normalization-a`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({
      provider: "grok-subscription",
      model: "fabricated",
      scope: "whole-document",
    }),
  })
  // Then
  expect(response.status).toBe(409)
  expect(await response.json()).toMatchObject({
    error: "subscription-unverified",
    transmission: "not-sent",
  })
  expect(dependencies.reviewStorage.counts()).toMatchObject({ setups: 0, grants: 0, jobs: 0 })
  expect(network).not.toHaveBeenCalled()
})
