import { randomUUID } from "node:crypto"
import { createServer } from "node:net"
import { serve } from "@hono/node-server"
import { openStorage } from "@reading-studio/storage"
import { createApp } from "./app.ts"

const [databasePath, privateDataRoot] = process.argv.slice(2)
if (!databasePath || !privateDataRoot) throw new TypeError("Missing API fixture paths")
const storage = openStorage({ databasePath, privateDataRoot, runtimeRole: "api" })
const reservation = createServer()
reservation.listen(0, "127.0.0.1")
await new Promise<void>((resolve) => reservation.once("listening", resolve))
const address = reservation.address()
if (!address || typeof address === "string") throw new TypeError("API port unavailable")
const port = address.port
await new Promise<void>((resolve) => reservation.close(() => resolve()))
const app = createApp({
  reviewStorage: storage,
  auth: {
    ownerId: async () => "owner",
    handler: async () => new Response(null, { status: 200, headers: { "set-cookie": "created" } }),
  },
  configurePrivateApi: (privateApi) => {
    privateApi.post("/api/maintenance-probe", (context) => {
      storage.sources.createInstallation({ id: randomUUID(), ownerId: "owner" })
      return context.json({ written: true }, 201)
    })
  },
  security: {
    apiBodyBytes: 1024,
    loginBodyBytes: 1024,
    loginRateLimit: { attempts: 5, windowMs: 60_000 },
    trustedOrigins: [`http://127.0.0.1:${port}`],
    trustProxy: false,
    uploadBodyBytes: 1024,
  },
})
const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port }, (info) => {
  process.stdout.write(`${info.port}\n`)
})
process.once("SIGTERM", () => server.close(() => storage.close()))
