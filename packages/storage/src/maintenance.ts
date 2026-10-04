import { randomUUID } from "node:crypto"
import { Job } from "@reading-studio/contracts"
import type Database from "better-sqlite3"
import { z } from "zod"
import { BackupError } from "./backup-schema.ts"
import type { StorageContext } from "./database.ts"
import { transitionJob } from "./execution-state.ts"
import {
  holdMaintenanceOperator,
  holdMaintenanceProcess,
  maintenanceHolderState,
  recoverWithQuiescence,
  registerMaintenanceInstance,
  releaseMaintenanceInstance,
} from "./maintenance-process-lock.ts"

const Gate = z.object({
  phase: z.enum(["idle", "draining", "frozen", "restoring"]),
  token: z.string().nullable(),
})
const Count = z.object({ count: z.number().int().nonnegative() })
const pause = new Int32Array(new SharedArrayBuffer(4))
const busy = (error: unknown): boolean =>
  z.object({ code: z.literal("SQLITE_BUSY") }).safeParse(error).success

export function maintenanceActive(sqlite: Database.Database): boolean {
  return (
    Gate.parse(sqlite.prepare("SELECT phase, token FROM maintenance_gate WHERE id = 1").get())
      .phase !== "idle"
  )
}

export class MaintenanceAdmission {
  constructor(private readonly context: StorageContext) {}

  enter(): string | null {
    if (maintenanceActive(this.context.sqlite)) return null
    return this.context.sqlite
      .transaction(() => {
        if (maintenanceActive(this.context.sqlite)) return null
        const token = randomUUID()
        this.context.sqlite
          .prepare("INSERT INTO maintenance_requests (token) VALUES (?)")
          .run(token)
        return token
      })
      .immediate()
  }

  leave(token: string): void {
    this.context.sqlite.prepare("DELETE FROM maintenance_requests WHERE token = ?").run(token)
  }

  active(): boolean {
    return maintenanceActive(this.context.sqlite)
  }

  phase(): "idle" | "draining" | "frozen" | "restoring" {
    return Gate.parse(
      this.context.sqlite.prepare("SELECT phase, token FROM maintenance_gate WHERE id = 1").get(),
    ).phase
  }
}

export function withMaintenance<T>(
  sqlite: Database.Database,
  operation: () => T,
  timeoutMs = 30_000,
  progress?: (phase: "draining" | "frozen") => void,
): T {
  const lock = holdMaintenanceProcess(sqlite.name)
  let holder: Database.Database
  try {
    holder = holdMaintenanceOperator(sqlite.name)
  } catch (error) {
    lock.close()
    throw error
  }
  let instanceId: string
  try {
    instanceId = registerMaintenanceInstance(sqlite, "operator")
  } catch (error) {
    holder.close()
    lock.close()
    throw error
  }
  try {
    return runMaintenance(sqlite, operation, timeoutMs, progress)
  } finally {
    try {
      releaseMaintenanceInstance(sqlite, instanceId)
    } finally {
      try {
        holder.close()
      } finally {
        lock.close()
      }
    }
  }
}

function runMaintenance<T>(
  sqlite: Database.Database,
  operation: () => T,
  timeoutMs: number,
  progress?: (phase: "draining" | "frozen") => void,
): T {
  const token = randomUUID()
  const deadline = Date.now() + timeoutMs
  while (true) {
    try {
      sqlite
        .transaction(() => {
          if (maintenanceActive(sqlite))
            throw new BackupError("maintenance already active; recover explicitly")
          sqlite
            .prepare("UPDATE maintenance_gate SET phase = 'draining', token = ? WHERE id = 1")
            .run(token)
        })
        .immediate()
      break
    } catch (error) {
      if (!busy(error)) throw error
      if (Date.now() >= deadline)
        throw new BackupError("maintenance acquisition timed out: SQLite writer locked")
      Atomics.wait(pause, 0, 0, 50)
    }
  }
  const outcome = (() => {
    try {
      progress?.("draining")
      while (true) {
        const drained = sqlite
          .transaction(() => {
            const gate = Gate.parse(
              sqlite.prepare("SELECT phase, token FROM maintenance_gate WHERE id = 1").get(),
            )
            if (gate.phase !== "draining" || gate.token !== token)
              throw new BackupError("maintenance lease lost")
            const now = new Date().toISOString()
            const expired = sqlite
              .prepare(
                "SELECT id, record_json, lease_fence FROM jobs WHERE state = 'running' AND lease_expires_at <= ?",
              )
              .all(now)
              .map((row) =>
                z
                  .object({
                    id: z.string(),
                    record_json: z.string(),
                    lease_fence: z.number().int(),
                  })
                  .parse(row),
              )
            for (const row of expired) {
              const job = Job.parse(JSON.parse(row.record_json))
              if (job.state !== "running") throw new BackupError("expired job record mismatch")
              const queued = transitionJob(job, { state: "queued" })
              sqlite
                .prepare(
                  "UPDATE jobs SET state = 'queued', record_json = ?, lease_token = NULL, lease_expires_at = NULL, lease_fence = ? WHERE id = ?",
                )
                .run(JSON.stringify(queued), row.lease_fence + 1, row.id)
            }
            const requests = Count.parse(
              sqlite.prepare("SELECT COUNT(*) AS count FROM maintenance_requests").get(),
            ).count
            const running = Count.parse(
              sqlite.prepare("SELECT COUNT(*) AS count FROM jobs WHERE state = 'running'").get(),
            ).count
            const outputs = Count.parse(
              sqlite
                .prepare(
                  "SELECT COUNT(*) AS count FROM publication_outputs WHERE state = 'running' AND json_extract(record_json, '$.expiresAt') > ?",
                )
                .get(new Date().toISOString()),
            ).count
            const uncertain = Count.parse(
              sqlite
                .prepare(
                  "SELECT COUNT(*) AS count FROM external_attempts WHERE state = 'dispatching' OR (state = 'outcome_unknown' AND json_extract(record_json, '$.resolution') = 'awaiting-owner')",
                )
                .get(),
            ).count
            if (requests || running || outputs || uncertain) return false
            sqlite
              .prepare("UPDATE maintenance_gate SET phase = 'frozen' WHERE id = 1 AND token = ?")
              .run(token)
            return true
          })
          .immediate()
        if (drained) break
        if (Date.now() >= deadline)
          throw new BackupError(
            "maintenance drain timed out: active writes, jobs, or uncertain dispatch; no snapshot taken",
          )
        Atomics.wait(pause, 0, 0, 50)
      }
      progress?.("frozen")
      return { kind: "completed" as const, value: operation() }
    } catch (error) {
      if (!(error instanceof Error)) throw error
      return { kind: "failed" as const, error }
    }
  })()
  const releaseDeadline = Date.now() + 5_000
  while (true) {
    try {
      sqlite
        .transaction(() => {
          sqlite
            .prepare(
              "UPDATE maintenance_gate SET phase = 'idle', token = NULL WHERE id = 1 AND token = ?",
            )
            .run(token)
        })
        .immediate()
      break
    } catch (error) {
      if (!busy(error)) throw error
      if (Date.now() >= releaseDeadline)
        throw new BackupError(
          "maintenance release blocked; use library maintenance-recover after the operator exits",
        )
      Atomics.wait(pause, 0, 0, 50)
    }
  }
  if (outcome.kind === "failed") throw outcome.error
  return outcome.value
}

export function recoverMaintenance(sqlite: Database.Database): void {
  recoverWithQuiescence(sqlite.name, () =>
    sqlite
      .transaction(() => {
        const gate = Gate.parse(
          sqlite.prepare("SELECT phase, token FROM maintenance_gate WHERE id = 1").get(),
        )
        if (gate.phase === "restoring") throw new BackupError("restore still active")
        if (gate.phase === "idle") throw new BackupError("no interrupted maintenance to recover")
        if (maintenanceHolderState(sqlite.name) !== "dead")
          throw new BackupError("maintenance holder is active or cannot be verified dead")
        sqlite.prepare("DELETE FROM maintenance_requests").run()
        sqlite.prepare("DELETE FROM maintenance_instances").run()
        sqlite
          .prepare("UPDATE maintenance_gate SET phase = 'idle', token = NULL WHERE id = 1")
          .run()
      })
      .immediate(),
  )
}

export function maintenanceStatus(sqlite: Database.Database): {
  readonly phase: "idle" | "draining" | "frozen" | "restoring"
  readonly processes: "active" | "quiesced"
  readonly holder: "active" | "dead" | "absent" | "unverified"
} {
  try {
    return recoverWithQuiescence(sqlite.name, () => {
      const phase = Gate.parse(
        sqlite.prepare("SELECT phase, token FROM maintenance_gate WHERE id = 1").get(),
      ).phase
      return {
        phase,
        processes: "quiesced" as const,
        holder: phase === "idle" ? ("absent" as const) : maintenanceHolderState(sqlite.name),
      }
    })
  } catch (error) {
    if (error instanceof BackupError && error.boundary.startsWith("recovery refused: active")) {
      const phase = Gate.parse(
        sqlite.prepare("SELECT phase, token FROM maintenance_gate WHERE id = 1").get(),
      ).phase
      return {
        phase,
        processes: "active",
        holder: phase === "idle" ? "absent" : maintenanceHolderState(sqlite.name),
      }
    }
    throw error
  }
}
