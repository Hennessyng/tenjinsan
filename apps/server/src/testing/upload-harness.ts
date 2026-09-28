import { once } from "node:events"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { getRequestListener } from "@hono/node-server"
import { openAuthStorage, openStorage } from "@reading-studio/storage"
import { createApp } from "../app.ts"
import { createOwnerAuth, createServerAuth } from "../auth/auth.ts"
import { createOwnerService } from "../auth/owner.ts"
import { productionIntake } from "../intake.ts"

export async function uploadHarness() {
  const directory = await mkdtemp(join(tmpdir(), "upload-http-"))
  const root = join(directory, "private")
  await mkdir(root, { mode: 0o700 })
  const server = createServer()
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  if (address === null || typeof address === "string") throw new TypeError("Missing address")
  const origin = `http://127.0.0.1:${address.port}`
  const storage = openAuthStorage(join(directory, "auth.sqlite"))
  const sourceStorage = openStorage({
    databasePath: join(directory, "auth.sqlite"),
    privateDataRoot: root,
  })
  const config = {
    baseURL: origin,
    secret: "upload-test-secret-with-thirty-two-characters",
    sessionExpiresIn: 3600,
  }
  const credentials = { email: "owner@example.test", password: "correct horse battery staple" }
  await createOwnerService(storage, createOwnerAuth(storage, config)).provision({
    ...credentials,
    name: "Owner",
  })
  const auth = createServerAuth(storage, config)
  const app = createApp({
    sources: sourceStorage.sources,
    auth: {
      handler: auth.handler,
      ownerId: async (headers) => (await auth.api.getSession({ headers }))?.user.id ?? null,
    },
    upload: {
      root,
      limits: { compressedBytes: 8192, decompressedBytes: 4096, entries: 10, entryBytes: 2048 },
      onAccepted: productionIntake(sourceStorage, root),
    },
    security: {
      apiBodyBytes: 1024,
      loginBodyBytes: 4096,
      loginRateLimit: { attempts: 10, windowMs: 60000 },
      trustedOrigins: [origin],
      trustProxy: false,
      uploadBodyBytes: 8192,
      logger: () => undefined,
    },
  })
  server.on("request", getRequestListener(app.fetch))
  const login = await fetch(`${origin}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(credentials),
  })
  const cookie = login.headers.getSetCookie()[0]?.split(";", 1)[0]
  if (!cookie) throw new TypeError("Login failed")
  return {
    root,
    sourceStorage,
    directory,
    origin,
    headers: { cookie, origin, "content-type": "application/epub+zip" },
    close: async () => {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
      storage.close()
      sourceStorage.close()
      await rm(directory, { recursive: true, force: true })
    },
  }
}
