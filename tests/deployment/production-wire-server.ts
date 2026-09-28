import { existsSync, readFileSync, watch, writeFileSync } from "node:fs"
import { z } from "zod"
import { startProductionWire, type WireFault } from "./production-wire.ts"

const path = "/data/production-wire-count"
const metricsPath = "/data/production-wire-metrics"
let count = existsSync(path) ? Number(readFileSync(path, "utf8")) : 0
const metrics = existsSync(metricsPath)
  ? z
      .array(
        z.object({
          bodyBytes: z.number(),
          sectionId: z.string().nullable(),
          fault: z.string().optional(),
          provider: z.string().optional(),
        }),
      )
      .parse(JSON.parse(readFileSync(metricsPath, "utf8")))
  : []
if (!existsSync(path)) writeFileSync(path, "0", { mode: 0o600 })
if (!existsSync(metricsPath)) writeFileSync(metricsPath, "[]", { mode: 0o600 })
const wire = await startProductionWire({
  port: 43117,
  fault: () =>
    existsSync("/data/matrix-wire-fault")
      ? z
          .enum(["normal", "malformed-output", "invalid-citation", "hold", "privacy-canary"])
          .parse(readFileSync("/data/matrix-wire-fault", "utf8"))
      : ("normal" satisfies WireFault),
  onRequest: (metric) => {
    metrics.push(metric)
    writeFileSync(metricsPath, JSON.stringify(metrics), { mode: 0o600 })
    writeFileSync(path, String(++count), { mode: 0o600 })
  },
})
const changes = watch("/data", (_event, filename) => {
  if (filename === "matrix-wire-release") wire.releaseHeld()
})
const stop = () => {
  changes.close()
  void wire.close()
}
process.once("SIGTERM", stop)
process.once("SIGINT", stop)
