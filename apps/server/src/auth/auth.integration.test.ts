import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openAuthStorage } from "@reading-studio/storage"
import { afterEach, describe, expect, it } from "vitest"
import { createApp } from "../app.ts"
import { createOwnerAuth, createServerAuth, type StudioAuthConfig } from "./auth.ts"
import {
  assertProvisionedOwner,
  createOwnerService,
  OwnerAlreadyExistsError,
  OwnerNotProvisionedError,
} from "./owner.ts"

const SECRET = "test-secret-with-at-least-thirty-two-characters"
const BASE_URL = "http://127.0.0.1:8787"
const EMAIL = "owner@example.test"
const PASSWORD = "correct horse battery staple"
const NEW_PASSWORD = "new correct horse battery staple"
const temporaryDirectories: string[] = []

type Harness = {
  readonly app: ReturnType<typeof createApp>
  readonly owner: ReturnType<typeof createOwnerService>
  readonly storage: ReturnType<typeof openAuthStorage>
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  )
})

async function createHarness(sessionExpiresIn = 60 * 60): Promise<Harness> {
  const directory = await mkdtemp(join(tmpdir(), "reading-studio-auth-"))
  temporaryDirectories.push(directory)
  const storage = openAuthStorage(join(directory, "studio.sqlite"))
  const config = {
    baseURL: BASE_URL,
    secret: SECRET,
    sessionExpiresIn,
  } satisfies StudioAuthConfig
  const serverAuth = createServerAuth(storage, config)
  const ownerAuth = createOwnerAuth(storage, config)
  return {
    app: createApp({
      auth: {
        handler: serverAuth.handler,
        ownerId: async (headers) => (await serverAuth.api.getSession({ headers }))?.user.id ?? null,
      },
      security: {
        apiBodyBytes: 1_048_576,
        loginBodyBytes: 16_384,
        loginRateLimit: { attempts: 20, windowMs: 60_000 },
        trustedOrigins: [BASE_URL],
        trustProxy: false,
        uploadBodyBytes: 52_428_800,
      },
    }),
    owner: createOwnerService(storage, ownerAuth),
    storage,
  }
}

async function provision(harness: Harness): Promise<void> {
  await harness.owner.provision({ email: EMAIL, name: "Studio Owner", password: PASSWORD })
}

async function postJson(
  harness: Harness,
  path: string,
  body: Readonly<Record<string, string>> = {},
  cookie?: string,
): Promise<Response> {
  const headers = new Headers({ "content-type": "application/json" })
  if (cookie !== undefined) {
    headers.set("cookie", cookie)
  }
  return harness.app.request(`${BASE_URL}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  })
}

function sessionCookie(response: Response): string {
  const setCookie = response.headers.get("set-cookie")
  if (setCookie === null) {
    throw new TypeError("Authentication response did not set a session cookie")
  }
  const cookie = setCookie.split(";", 1)[0]
  if (cookie === undefined) {
    throw new TypeError("Authentication response set an invalid session cookie")
  }
  return cookie
}

async function signIn(harness: Harness, password = PASSWORD): Promise<Response> {
  return postJson(harness, "/api/auth/sign-in/email", { email: EMAIL, password })
}

async function readSession(harness: Harness, cookie: string): Promise<Response> {
  return harness.app.request(`${BASE_URL}/api/auth/get-session`, {
    headers: { cookie },
  })
}

describe("single-owner email and password authentication", () => {
  it("creates a session for the provisioned owner with valid credentials", async () => {
    const harness = await createHarness()
    await provision(harness)

    const login = await signIn(harness)
    const session = await readSession(harness, sessionCookie(login))

    expect(login.status).toBe(200)
    expect(session.status).toBe(200)
    expect(await session.json()).toMatchObject({ user: { email: EMAIL } })
    harness.storage.close()
  })

  it("supports browser form login and logout without a sign-up surface", async () => {
    const harness = await createHarness()
    await provision(harness)
    const form = new FormData()
    form.set("email", EMAIL)
    form.set("password", PASSWORD)

    const login = await harness.app.request(`${BASE_URL}/login`, {
      method: "POST",
      headers: { origin: BASE_URL },
      body: form,
    })
    const cookie = sessionCookie(login)
    const workspace = await harness.app.request(BASE_URL, { headers: { cookie } })
    const logout = await harness.app.request(`${BASE_URL}/logout`, {
      method: "POST",
      headers: { cookie, origin: BASE_URL },
    })

    expect(login.status).toBe(303)
    expect(workspace.status).toBe(200)
    expect(await workspace.text()).toContain('data-authenticated="true"')
    expect(logout.status).toBe(303)
    expect(await (await readSession(harness, cookie)).json()).toBeNull()
    harness.storage.close()
  })

  it("returns the same generic denial for a wrong password and an unknown email", async () => {
    const harness = await createHarness()
    await provision(harness)

    const wrongPassword = await signIn(harness, "definitely-wrong-password")
    const unknownOwner = await postJson(harness, "/api/auth/sign-in/email", {
      email: "unknown@example.test",
      password: "definitely-wrong-password",
    })

    expect(wrongPassword.status).toBe(401)
    expect(unknownOwner.status).toBe(401)
    expect(await wrongPassword.json()).toEqual(await unknownOwner.json())
    harness.storage.close()
  })

  it("invalidates the current session on sign-out", async () => {
    const harness = await createHarness()
    await provision(harness)
    const cookie = sessionCookie(await signIn(harness))

    const logout = await postJson(harness, "/api/auth/sign-out", {}, cookie)
    const session = await readSession(harness, cookie)

    expect(logout.status).toBe(200)
    expect(await session.json()).toBeNull()
    harness.storage.close()
  })

  it("rejects a database session after its expiry time", async () => {
    const harness = await createHarness(1)
    await provision(harness)
    const cookie = sessionCookie(await signIn(harness))
    harness.storage.sqlite
      .prepare("UPDATE auth_sessions SET expires_at = ?")
      .run(Date.now() - 1_000)

    const session = await readSession(harness, cookie)

    expect(await session.json()).toBeNull()
    harness.storage.close()
  })

  it("keeps the public sign-up endpoint disabled", async () => {
    const harness = await createHarness()

    const response = await postJson(harness, "/api/auth/sign-up/email", {
      email: "second@example.test",
      name: "Second Owner",
      password: PASSWORD,
    })

    expect(response.status).toBe(400)
    expect(harness.storage.ownerCount()).toBe(0)
    harness.storage.close()
  })

  it("refuses a second owner through both the service and the database", async () => {
    const harness = await createHarness()
    await provision(harness)

    await expect(
      harness.owner.provision({
        email: "second@example.test",
        name: "Second Owner",
        password: PASSWORD,
      }),
    ).rejects.toBeInstanceOf(OwnerAlreadyExistsError)
    expect(
      (
        await postJson(harness, "/api/auth/sign-up/email", {
          email: "second@example.test",
          name: "Second Owner",
          password: PASSWORD,
        })
      ).status,
    ).toBe(400)
    expect(() =>
      harness.storage.sqlite
        .prepare("INSERT INTO auth_users (id, name, email, email_verified) VALUES (?, ?, ?, ?)")
        .run("second-owner", "Second Owner", "second@example.test", 0),
    ).toThrow()
    expect(harness.storage.ownerCount()).toBe(1)
    expect(harness.storage.authUserCount()).toBe(1)
    harness.storage.close()
  })

  it("revokes every old session when the owner password is reset", async () => {
    const harness = await createHarness()
    await provision(harness)
    const oldCookie = sessionCookie(await signIn(harness))

    await harness.owner.resetPassword(NEW_PASSWORD)

    expect(await (await readSession(harness, oldCookie)).json()).toBeNull()
    expect((await signIn(harness)).status).toBe(401)
    expect((await signIn(harness, NEW_PASSWORD)).status).toBe(200)
    harness.storage.close()
  })

  it("refuses normal startup until exactly one owner is provisioned", async () => {
    const harness = await createHarness()

    expect(() => assertProvisionedOwner(harness.storage)).toThrow(OwnerNotProvisionedError)
    await provision(harness)
    expect(assertProvisionedOwner(harness.storage)).toEqual({ email: EMAIL })
    harness.storage.close()
  })
})
