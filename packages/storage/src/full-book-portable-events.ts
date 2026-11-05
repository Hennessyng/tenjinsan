import { assertNever, ExternalAttempt } from "@reading-studio/contracts"
import { z } from "zod"
import type { Row } from "./backup-row.ts"
import { BackupError } from "./backup-schema.ts"

export function validateAuditEvents(rows: readonly Row[], attempts: readonly ExternalAttempt[]) {
  const byId = new Map<string, ExternalAttempt>(),
    seen = new Set<number>()
  let last = 0
  for (const row of rows) {
    const sequence = z.number().int().positive().parse(row["sequence"])
    if (sequence <= last || seen.has(sequence)) throw new BackupError("experimental event order")
    seen.add(sequence)
    last = sequence
    const event = ExternalAttempt.parse(JSON.parse(z.string().parse(row["record_json"])))
    const actual = attempts.find((attempt) => attempt.id === event.id)
    if (
      !actual ||
      row["attempt_id"] !== event.id ||
      ["runId", "inputRevisionId", "reservation", "preparedAt"].some((key) => {
        const values = z.record(z.string(), z.unknown()).parse(event),
          other = z.record(z.string(), z.unknown()).parse(actual)
        return values[key] !== other[key]
      })
    )
      throw new BackupError("experimental event binding")
    const previous = byId.get(event.id)
    if (!previous) {
      if (event.state !== "prepared") throw new BackupError("experimental event origin")
    } else {
      let allowed = false
      switch (previous.state) {
        case "prepared":
          allowed = event.state === "dispatching" || event.state === "outcome_unknown"
          break
        case "dispatching":
          allowed = event.state === "response-received" || event.state === "outcome_unknown"
          break
        case "outcome_unknown":
          allowed =
            event.state === "response-received" ||
            (event.state === "outcome_unknown" &&
              previous.resolution === "awaiting-owner" &&
              event.resolution !== "awaiting-owner")
          break
        case "response-received":
          break
        default:
          assertNever(previous)
      }
      if (!allowed) throw new BackupError("experimental event transition")
    }
    byId.set(event.id, event)
  }
  for (const attempt of attempts)
    if (JSON.stringify(byId.get(attempt.id)) !== JSON.stringify(attempt))
      throw new BackupError("experimental event tail missing or changed")
}
