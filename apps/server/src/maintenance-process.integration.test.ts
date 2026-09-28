import { spawn } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  maintenanceStatus,
  openMaintenanceDatabase,
  openStorage,
  recoverMaintenance,
} from "@reading-studio/storage"
import { expect, it } from "vitest"

it("refuses frozen recovery until all separately spawned API writers exit", async () => {
  const root = mkdtempSync(join(tmpdir(), "maintenance-process-"))
  const paths = {
    databasePath: join(root, "studio.sqlite"),
    privateDataRoot: join(root, "private"),
  }
  const storage = openStorage(paths)
  storage.sources.createOwner("owner")
  storage.close()
  const sqlite = openMaintenanceDatabase(paths.databasePath)
  const children: ReturnType<typeof spawn>[] = []
  const launch = async (file: string, extra: readonly string[] = []) => {
    const child = spawn(
      process.execPath,
      [
        "--experimental-transform-types",
        fileURLToPath(new URL(file, import.meta.url)),
        paths.databasePath,
        paths.privateDataRoot,
        ...extra,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    )
    children.push(child)
    const output = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new TypeError("Maintenance child not ready")), 10_000)
      child.stdout.once("data", (data: Buffer) => {
        clearTimeout(timer)
        resolve(data.toString().trim())
      })
      child.once("error", reject)
    })
    return { child, output }
  }
  const stop = async (child: ReturnType<typeof spawn>) => {
    child.kill("SIGKILL")
    await new Promise<void>((resolve) => child.once("close", () => resolve()))
  }
  try {
    const first = await launch("./maintenance-api-fixture.ts")
    const second = await launch("./maintenance-api-fixture.ts")
    const worker = await launch("../../worker/tests/maintenance-worker-process.ts")
    expect(worker.output).toBe("worker-ready")
    const holder = await launch("../../../tests/deployment/maintenance-hold.ts", [
      join(root, "release"),
    ])
    expect(holder.output).toBe("frozen")
    expect(maintenanceStatus(sqlite)).toMatchObject({ holder: "active", processes: "active" })
    await stop(holder.child)
    expect(sqlite.prepare("SELECT role FROM maintenance_instances ORDER BY role").all()).toEqual([
      { role: "api" },
      { role: "api" },
      { role: "operator" },
      { role: "worker" },
    ])
    expect(maintenanceStatus(sqlite)).toMatchObject({
      phase: "frozen",
      holder: "dead",
      processes: "active",
    })
    expect(() => recoverMaintenance(sqlite)).toThrow(/active|running|quiesc/i)
    for (const server of [first, second]) {
      const origin = `http://127.0.0.1:${Number(server.output)}`
      const health = await fetch(`${origin}/health`)
      expect(health.status).toBe(200)
      expect(await health.json()).toMatchObject({ maintenance: "frozen" })
      const write = await fetch(`${origin}/api/maintenance-probe`, {
        method: "POST",
        headers: { origin },
      })
      expect(write.status).toBe(503)
      const login = await fetch(`${origin}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { origin },
      })
      expect(login.status).toBe(503)
      expect(login.headers.get("set-cookie")).toBeNull()
    }
    expect(sqlite.prepare("SELECT id FROM installations").all()).toEqual([])
    await stop(first.child)
    expect(() => recoverMaintenance(sqlite)).toThrow(/active|running|quiesc/i)
    await stop(second.child)
    expect(() => recoverMaintenance(sqlite)).toThrow(/active|running|quiesc/i)
    await stop(worker.child)
    expect(maintenanceStatus(sqlite)).toMatchObject({
      phase: "frozen",
      holder: "dead",
      processes: "quiesced",
    })
    recoverMaintenance(sqlite)
    expect(sqlite.prepare("SELECT id FROM maintenance_instances").all()).toEqual([])
    const resumed = await launch("./maintenance-api-fixture.ts")
    const origin = `http://127.0.0.1:${Number(resumed.output)}`
    expect(
      (
        await fetch(`${origin}/api/maintenance-probe`, {
          method: "POST",
          headers: { origin, "content-type": "application/json" },
          body: "{}",
        })
      ).status,
    ).toBe(201)
  } finally {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
    }
    await Promise.all(
      children.map((child) =>
        child.exitCode === null && child.signalCode === null
          ? new Promise<void>((resolve) => child.once("close", () => resolve()))
          : Promise.resolve(),
      ),
    )
    sqlite.close()
    rmSync(root, { recursive: true, force: true })
  }
}, 35_000)
