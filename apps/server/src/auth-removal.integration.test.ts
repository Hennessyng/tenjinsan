import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openAuthStorage, openStorage } from "@reading-studio/storage"
import { sourceFixtures } from "@reading-studio/storage/test-support"
import { afterEach, expect, test, vi } from "vitest"
import { createApp } from "./app.ts"
import { parseServerConfig } from "./config.ts"
import { assertLocalOwner } from "./local-startup.ts"

const cleanups: (() => void | Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close()
})

async function library() {
  const directory = await mkdtemp(join(tmpdir(), "anonymous-library-"))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  const databasePath = join(directory, "studio.sqlite")
  const storage = openStorage({ databasePath, privateDataRoot: join(directory, "private") })
  cleanups.push(() => storage.close())
  return { storage, databasePath }
}

const studioAssets = {
  index: '<!doctype html><html><body><div id="root">Library workspace</div></body></html>',
  files: new Map(),
}
const security = (origin: string) => ({
  trustedOrigins: [origin],
  trustProxy: false,
  apiBodyBytes: 64,
  uploadBodyBytes: 16,
  loginBodyBytes: 64,
  loginRateLimit: { attempts: 5, windowMs: 60_000 },
  logger: () => undefined,
})

test.each(["http://127.0.0.1:8787", "https://library.example"])(
  "anonymous root, room and library API open at %s",
  async (origin) => {
    const { storage } = await library()
    storage.sources.createOwner("existing-owner")
    const document = sourceFixtures()
    storage.sources.persistDocument({
      edition: document.edition,
      normalization: document.normalization,
    })
    storage.sources.createStudy({
      id: "study-1",
      ownerId: "existing-owner",
      editionId: document.edition.id,
    })
    const resolveSession = vi.fn(async () => null)
    const authenticate = vi.fn(async () => new Response(null, { status: 401 }))
    const app = createApp({
      auth: { ownerId: resolveSession, handler: authenticate },
      reviewStorage: storage,
      sources: storage.sources,
      studioAssets,
      security: security(origin),
    })
    for (const path of ["/", "/sources", "/briefs/study-1"]) {
      const response = await app.request(origin + path)
      expect(response.status).toBe(200)
      expect(response.headers.get("location")).toBeNull()
      expect(response.headers.get("set-cookie")).toBeNull()
      expect(await response.text()).toContain('id="root"')
    }
    const response = await app.request(origin + "/api/library-context")
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      studies: [{ id: "study-1", title: document.edition.title }],
    })
    expect(resolveSession).not.toHaveBeenCalled()
    expect(authenticate).not.toHaveBeenCalled()
  },
)

test("fresh local setup creates only stable internal ownership without password provisioning", async () => {
  const { databasePath } = await library()
  expect(() => assertLocalOwner(databasePath)).not.toThrow()
  const database = openAuthStorage(databasePath)
  try {
    const before = database.sqlite.prepare("SELECT id FROM owners").all()
    expect(before).toHaveLength(1)
    expect(database.authUserCount()).toBe(0)
    expect(database.sqlite.prepare("SELECT count(*) AS n FROM auth_accounts").get()).toEqual({
      n: 0,
    })
    assertLocalOwner(databasePath)
    expect(database.sqlite.prepare("SELECT id FROM owners").all()).toEqual(before)
  } finally {
    database.close()
  }
})

test("upgrade preserves legacy identities, credentials, sessions and populated content", async () => {
  const { storage, databasePath } = await library()
  const legacy = openAuthStorage(databasePath)
  try {
    legacy.sqlite
      .prepare("INSERT INTO auth_users(id,name,email) VALUES(?,?,?)")
      .run("legacy-owner", "Legacy", "synthetic@example.test")
    legacy.sqlite
      .prepare(
        "INSERT INTO auth_accounts(id,account_id,provider_id,user_id,password) VALUES(?,?,?,?,?)",
      )
      .run(
        "legacy-account",
        "legacy-owner",
        "credential",
        "legacy-owner",
        "synthetic-preserved-hash",
      )
    legacy.sqlite
      .prepare("INSERT INTO auth_sessions(id,expires_at,token,user_id) VALUES(?,?,?,?)")
      .run("legacy-session", Date.now() + 60_000, "synthetic-preserved-token", "legacy-owner")
    const before = ["owners", "auth_users", "auth_accounts", "auth_sessions"].map((table) =>
      legacy.sqlite.prepare(`SELECT * FROM ${table}`).all(),
    )
    const document = sourceFixtures()
    storage.sources.persistDocument({
      edition: document.edition,
      normalization: document.normalization,
    })
    storage.sources.createStudy({
      id: "study-1",
      ownerId: "legacy-owner",
      editionId: document.edition.id,
    })
    const app = createApp({
      auth: { ownerId: async () => null, handler: async () => new Response(null, { status: 401 }) },
      reviewStorage: storage,
      sources: storage.sources,
      security: security("http://localhost"),
    })
    const response = await app.request("http://localhost/api/source-library")
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ documents: [{ edition: document.edition }] })
    expect(
      ["owners", "auth_users", "auth_accounts", "auth_sessions"].map((table) =>
        legacy.sqlite.prepare(`SELECT * FROM ${table}`).all(),
      ),
    ).toEqual(before)
    expect(storage.sources.listStudiesByEdition(document.edition.id)[0]?.ownerId).toBe(
      "legacy-owner",
    )
  } finally {
    legacy.close()
  }
})

test("retired login URLs return to the app and no auth endpoint creates a session", async () => {
  const { storage } = await library()
  storage.sources.createOwner("owner")
  const handler = vi.fn(async () => new Response("must not run", { status: 401 }))
  const app = createApp({
    auth: { ownerId: async () => null, handler },
    reviewStorage: storage,
    studioAssets,
    security: security("http://localhost"),
  })
  for (const path of ["/login", "/logout"]) {
    const response = await app.request("http://localhost" + path)
    expect(response.status).toBe(303)
    expect(response.headers.get("location")).toBe("/")
  }
  const response = await app.request("http://localhost/api/auth/sign-in/email", {
    method: "POST",
    headers: { origin: "http://localhost", "content-type": "application/json" },
    body: "{}",
  })
  expect(response.status).toBe(410)
  expect(response.headers.get("set-cookie")).toBeNull()
  expect(handler).not.toHaveBeenCalled()
})

test.each([
  [{ method: "POST", headers: { "content-type": "application/json" }, body: "{}" }, 403],
  [
    {
      method: "POST",
      headers: { origin: "https://evil.example", "content-type": "application/json" },
      body: "{}",
    },
    403,
  ],
  [
    {
      method: "POST",
      headers: { origin: "http://localhost", "content-type": "text/plain" },
      body: "x",
    },
    415,
  ],
  [
    {
      method: "POST",
      headers: { origin: "http://localhost", "content-type": "application/json" },
      body: JSON.stringify({ text: "x".repeat(80) }),
    },
    413,
  ],
] as const)("anonymous mutations retain non-auth safeguards %#", async (init, status) => {
  const { storage } = await library()
  storage.sources.createOwner("owner")
  const app = createApp({
    auth: { ownerId: async () => null, handler: async () => new Response(null, { status: 401 }) },
    reviewStorage: storage,
    security: security("http://localhost"),
    configurePrivateApi: (api) => {
      api.post("/api/test-command", (context) => context.json({ ok: true }))
    },
  })
  expect((await app.request("http://localhost/api/test-command", init)).status).toBe(status)
  expect((await app.request("http://localhost/data/studio.sqlite")).status).toBe(404)
})

test("server config does not require obsolete authentication settings", () => {
  expect(() =>
    parseServerConfig({
      DATABASE_PATH: "data/studio.sqlite",
      SERVER_HOST: "0.0.0.0",
      SERVER_PORT: "8787",
      TRUSTED_ORIGINS: "https://library.example",
      TRUST_PROXY: "0",
    }),
  ).not.toThrow()
})
