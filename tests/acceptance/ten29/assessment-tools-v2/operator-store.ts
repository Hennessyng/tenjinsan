import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { z } from "zod"
import { verifyExistingDeliveries } from "./delivery-receipts.ts"
import { digest } from "./integrity.ts"
import { checkPrepared } from "./prepared-lock.ts"
import { HumanWorkflow } from "./workflow.ts"
import { Enrollment, Manifest, type Sealed } from "./workflow-schema.ts"
export const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"))
export const saveNew = (path: string, value: unknown) =>
  writeFileSync(path, JSON.stringify(value, null, 2), { flag: "wx", mode: 0o600 })
export function enroll(packetRoot: string, authorizationFile: string) {
  const coordinator = join(packetRoot, "coordinator"),
    manifest = Manifest.parse(readJson(join(coordinator, "manifest.json")))
  const key = checkPrepared(packetRoot)
  const approved = z
    .strictObject({ status: z.literal("HUMAN_AUTHORIZED"), authorization: Enrollment })
    .parse(readJson(authorizationFile))
  new HumanWorkflow({ manifest, enrollment: approved.authorization, key })
  saveNew(join(coordinator, "enrollment.json"), approved.authorization)
}
export function loadWorkflow(packetRoot: string) {
  const coordinator = join(packetRoot, "coordinator")
  const workflow = new HumanWorkflow({
    manifest: readJson(join(coordinator, "manifest.json")),
    enrollment: readJson(join(coordinator, "enrollment.json")),
    key: checkPrepared(packetRoot),
  })
  const names = readdirSync(join(coordinator, "events")).sort()
  if (names.some((name, index) => name !== `${String(index).padStart(6, "0")}.json`))
    throw new TypeError("Non-contiguous operator journal")
  workflow.replay(names.map((name) => readJson(join(coordinator, "events", name))))
  verifyExistingDeliveries(packetRoot)
  const records = join(coordinator, "first-passes")
  if (existsSync(records))
    for (const name of readdirSync(records)) {
      const assessment = workflow
        .snapshot()
        .assessments.find((row) => `${row.candidateCode}.json` === name)
      if (!assessment || digest(readJson(join(records, name))) !== digest(assessment))
        throw new TypeError("Retained first pass/journal differs; do not replay")
    }
  return workflow
}
export function persistEvent(packetRoot: string, workflow: HumanWorkflow, receipt: Sealed) {
  const index = workflow.snapshot().journal.length - 1
  saveNew(
    join(packetRoot, "coordinator", "events", `${String(index).padStart(6, "0")}.json`),
    receipt,
  )
  const last = workflow.snapshot().assessments.at(-1)
  if (
    last &&
    !existsSync(join(packetRoot, "coordinator", "first-passes", `${last.candidateCode}.json`))
  ) {
    mkdirSync(join(packetRoot, "coordinator", "first-passes"), { recursive: true, mode: 0o700 })
    saveNew(join(packetRoot, "coordinator", "first-passes", `${last.candidateCode}.json`), last)
  }
}
export function readHumanResponse(path: string): unknown {
  return z
    .strictObject({ status: z.literal("HUMAN_COMPLETED"), response: z.unknown() })
    .parse(readJson(path)).response
}
