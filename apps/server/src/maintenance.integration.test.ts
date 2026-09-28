import { spawn } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { serve } from "@hono/node-server"
import {
  captureLibrary,
  openMaintenanceDatabase,
  openStorage,
  recoverMaintenance,
} from "@reading-studio/storage"
import { expect, it } from "vitest"
import { createApp } from "./app.ts"

it("rejects owner writes and new sessions on two API processes sharing maintenance state", async () => {
  const root = mkdtempSync(join(tmpdir(), "maintenance-http-"))
  const paths = {
    databasePath: join(root, "studio.sqlite"),
    privateDataRoot: join(root, "private"),
  }
  const first = openStorage(paths)
  const second = openStorage(paths)
  first.sources.createOwner("owner")
  let sessions = 0
  const servers: ReturnType<typeof serve>[] = []
  for (const storage of [first, second]) {
    const reservation = createServer()
    reservation.listen(0, "127.0.0.1")
    await new Promise<void>((resolve) => reservation.once("listening", resolve))
    const reservedAddress = reservation.address()
    if (!reservedAddress || typeof reservedAddress === "string")
      throw new TypeError("API port unavailable")
    const port = reservedAddress.port
    await new Promise<void>((resolve) => reservation.close(() => resolve()))
    const origin = `http://127.0.0.1:${port}`
    const app = createApp({
      reviewStorage: storage,
      auth: {
        ownerId: async () => "owner",
        handler: async () => {
          sessions += 1
          return new Response(null, { status: 200, headers: { "set-cookie": "session=new" } })
        },
      },
      configurePrivateApi: (privateApi) => {
        privateApi.post("/api/maintenance-probe", (context) => {
          storage.sources.createInstallation({ id: crypto.randomUUID(), ownerId: "owner" })
          return context.json({ written: true }, 201)
        })
      },
      security: {
        apiBodyBytes: 1024,
        loginBodyBytes: 1024,
        loginRateLimit: { attempts: 5, windowMs: 60_000 },
        trustedOrigins: [origin],
        trustProxy: false,
        uploadBodyBytes: 1024,
      },
    })
    servers.push(serve({ fetch: app.fetch, hostname: "127.0.0.1", port }))
  }
  const sqlite = openMaintenanceDatabase(paths.databasePath)
  const releasePath = join(root, "release")
  const holder = spawn(
    process.execPath,
    [
      "--disable-warning=ExperimentalWarning",
      "--experimental-transform-types",
      fileURLToPath(new URL("../../../tests/deployment/maintenance-hold.ts", import.meta.url)),
      paths.databasePath,
      paths.privateDataRoot,
      releasePath,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  )
  const holderClosed = new Promise<void>((resolve) => holder.once("close", () => resolve()))
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new TypeError("Backup did not freeze")), 10_000)
      holder.stdout.once("data", (chunk: Buffer) => {
        clearTimeout(timeout)
        chunk.toString().includes("frozen")
          ? resolve()
          : reject(new TypeError("Backup did not freeze"))
      })
      holder.once("error", reject)
    })
    for (const server of servers) {
      const address = server.address()
      if (!address || typeof address === "string") throw new TypeError("API port unavailable")
      const origin = `http://127.0.0.1:${address.port}`
      const write = await fetch(`${origin}/api/maintenance-probe`, {
        method: "POST",
        headers: { origin },
      })
      expect(write.status).toBe(503)
      expect(write.headers.get("retry-after")).toBe("3")
      const login = await fetch(`${origin}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { origin },
      })
      expect(login.status).toBe(503)
      expect(login.headers.get("set-cookie")).toBeNull()
    }
    expect(sessions).toBe(0)
    expect(sqlite.prepare("SELECT id FROM installations").all()).toEqual([])
    holder.kill("SIGKILL")
    await holderClosed
    const gate = sqlite.prepare("SELECT phase FROM maintenance_gate WHERE id = 1").get()
    expect(gate).toEqual({ phase: "frozen" })
    expect(() => captureLibrary(paths, 100)).toThrow(/already active/)
    expect(() => recoverMaintenance(sqlite)).toThrow(/active|quiesc/i)
  } finally {
    if (holder.exitCode === null && holder.signalCode === null) holder.kill("SIGKILL")
    await holderClosed
    await Promise.all(
      servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
    )
    first.close()
    second.close()
    recoverMaintenance(sqlite)
    sqlite.close()
    rmSync(root, { recursive: true, force: true })
  }
}, 15_000)
