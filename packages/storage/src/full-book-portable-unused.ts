import {
  contentDigest,
  type FullBookTestConsent,
  FullBookTestReceipt,
  fullBookUnusedBatch,
} from "@reading-studio/contracts"
import { z } from "zod"
import { BackupError } from "./backup-schema.ts"
import { fullBookJobId } from "./full-book-execution-history.ts"
import type { FullBookAudit } from "./full-book-portable-schema.ts"

export function portableFullBookReceipts(audit: FullBookAudit, consent: FullBookTestConsent) {
  const rows = new Map<number, FullBookTestReceipt>(),
    local = new Set<number>(),
    remote = new Set<number>(),
    localTargets = new Map<number, string>()
  const parse = z.object({
    consent_id: z.literal(consent.id),
    node_index: z.number().int().nonnegative(),
    job_id: z.string(),
    record_json: z.string(),
  })
  for (const raw of audit.receipts) {
    const row = parse.parse(raw)
    if (rows.has(row.node_index) || row.job_id !== fullBookJobId(consent, row.node_index))
      throw new BackupError("experimental duplicate receipt binding")
    rows.set(row.node_index, FullBookTestReceipt.parse(JSON.parse(row.record_json)))
    remote.add(row.node_index)
  }
  const root = rows.get(
    consent.session.plan.nodes.findIndex((node) => node.id === consent.session.plan.root),
  )
  for (const raw of audit.notNeeded ?? []) {
    const row = parse.extend({ root_hash: z.string(), released_calls: z.literal(2) }).parse(raw)
    if (!root || rows.has(row.node_index) || row.job_id !== fullBookJobId(consent, row.node_index))
      throw new BackupError("experimental unused root binding")
    const expected = fullBookUnusedBatch(consent.session, root, row.node_index),
      receipt = FullBookTestReceipt.parse(JSON.parse(row.record_json))
    if (
      !expected ||
      row.root_hash !== root.outputHash ||
      receipt.serialized !== JSON.stringify(expected) ||
      receipt.outputHash !== contentDigest(receipt.serialized)
    )
      throw new BackupError("experimental unused evidence tampered")
    rows.set(row.node_index, receipt)
    local.add(row.node_index)
    localTargets.set(row.node_index, expected.targetHash)
  }
  const receipts: FullBookTestReceipt[] = []
  while (rows.has(receipts.length)) {
    const receipt = rows.get(receipts.length)
    if (!receipt) throw new BackupError("experimental receipt missing")
    receipts.push(receipt)
  }
  if ([...remote].some((index) => index >= receipts.length))
    throw new BackupError("experimental remote receipt gap")
  return { receipts, local, localTargets }
}
