import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openAuthStorage } from "@reading-studio/storage"
import { expect, it } from "vitest"
import { createApp } from "../app.ts"
import { createOwnerAuth, createServerAuth } from "./auth.ts"
import { createOwnerService } from "./owner.ts"

it("retains legacy identity mapping while retired forms no longer authenticate credentials", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ten17-identity-"))
  const storage = openAuthStorage(join(directory, "fixture.sqlite"))
  try {
    const config = {
      baseURL: "http://127.0.0.1:8787",
      secret: "synthetic-identity-secret-at-least-thirty-two-characters",
      sessionExpiresIn: 3600,
    }
    const owner = createOwnerService(storage, createOwnerAuth(storage, config))
    const server = createServerAuth(storage, config)
    const app = createApp({
      auth: {
        handler: server.handler,
        ownerId: async (headers) => (await server.api.getSession({ headers }))?.user.id ?? null,
      },
      security: {
        trustedOrigins: [config.baseURL],
        trustProxy: false,
        apiBodyBytes: 1024,
        uploadBodyBytes: 1024,
        loginBodyBytes: 16384,
        loginRateLimit: { attempts: 10, windowMs: 60_000 },
        logger: () => undefined,
      },
    })
    const login = (email: string, password: string) =>
      app.request(`${config.baseURL}/login`, {
        method: "POST",
        headers: { origin: config.baseURL },
        body: new URLSearchParams({ email, password }),
      })
    const originalPassword = "synthetic before identity reset"
    const newPassword = "synthetic after identity reset"
    await owner.provision({
      email: "Case.Owner+Tag@EXAMPLE.TEST",
      name: "Synthetic Owner",
      password: originalPassword,
    })
    const before = storage.provisionedOwner()
    expect(before?.email).toBe("case.owner+tag@example.test")
    expect((await login("Case.Owner+Tag@EXAMPLE.TEST", originalPassword)).status).toBe(303)
    await owner.resetPassword(newPassword)
    expect(storage.provisionedOwner()).toEqual(before)
    expect(storage.ownerCount()).toBe(1)
    expect(storage.authUserCount()).toBe(1)
    const account = storage.sqlite
      .prepare(
        "SELECT user_id AS userId, account_id AS accountId, provider_id AS providerId FROM auth_accounts",
      )
      .all()
    expect(account).toEqual([
      { userId: before?.id, accountId: before?.id, providerId: "credential" },
    ])
    expect((await login("Case.Owner+Tag@EXAMPLE.TEST", newPassword)).status).toBe(303)
    expect((await login("case.owner+tag@example.test", newPassword)).status).toBe(303)
    expect((await login("case.owner+tag@example.test", originalPassword)).status).toBe(303)
    const retired = await login("case.owner@example.test", newPassword)
    expect(retired.status).toBe(303)
    expect(retired.headers.get("set-cookie")).toBeNull()
  } finally {
    storage.close()
    await rm(directory, { recursive: true, force: true })
  }
})
