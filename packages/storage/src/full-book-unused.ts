import {
  contentDigest,
  type FullBookTestConsent,
  FullBookTestReceipt,
  fullBookUnusedBatch,
} from "@reading-studio/contracts"
import { z } from "zod"
import { FullBookExecutionError } from "./full-book-execution-contract.ts"
import { fullBookJobId } from "./full-book-execution-history.ts"
import type { FullBookExecutionStore } from "./full-book-execution-store.ts"

export function vacateUnusedBatches(
  s: FullBookExecutionStore,
  consent: FullBookTestConsent,
  root: FullBookTestReceipt,
) {
  if (consent.session.input.hierarchyPolicy !== "direct-children-2") return
  for (const [index] of consent.session.plan.nodes.entries()) {
    const output = fullBookUnusedBatch(consent.session, root, index)
    if (!output) continue
    const job = s.job(fullBookJobId(consent, index)),
      serialized = JSON.stringify(output)
    s.sqlite
      .prepare("INSERT INTO full_book_not_needed VALUES (?,?,?,?,2,?)")
      .run(
        consent.id,
        index,
        job.id,
        root.outputHash,
        JSON.stringify({ serialized, outputHash: contentDigest(serialized) }),
      )
    s.sqlite
      .prepare("UPDATE full_book_jobs SET state='completed',target_hash=? WHERE id=?")
      .run(output.targetHash, job.id)
    s.writeRun({ ...s.run(job.run_id), state: "completed" })
  }
}

export function readUnusedBatch(
  s: FullBookExecutionStore,
  consent: FullBookTestConsent,
  index: number,
) {
  const row = z
    .object({
      record_json: z.string(),
      root_hash: z.string(),
      released_calls: z.literal(2),
      job_id: z.string(),
    })
    .parse(
      s.sqlite
        .prepare("SELECT * FROM full_book_not_needed WHERE consent_id=? AND node_index=?")
        .get(consent.id, index),
    )
  const rootIndex = consent.session.plan.nodes.findIndex(
    (node) => node.id === consent.session.plan.root,
  )
  const rootRow = z
    .object({ record_json: z.string() })
    .parse(
      s.sqlite
        .prepare(
          "SELECT record_json FROM full_book_output_receipts WHERE consent_id=? AND node_index=?",
        )
        .get(consent.id, rootIndex),
    )
  const root = FullBookTestReceipt.parse(JSON.parse(rootRow.record_json)),
    expected = fullBookUnusedBatch(consent.session, root, index)
  const receipt = FullBookTestReceipt.parse(JSON.parse(row.record_json)),
    job = s.job(row.job_id),
    run = s.run(job.run_id)
  if (
    !expected ||
    row.root_hash !== root.outputHash ||
    row.job_id !== fullBookJobId(consent, index) ||
    receipt.serialized !== JSON.stringify(expected) ||
    receipt.outputHash !== contentDigest(receipt.serialized) ||
    job.state !== "completed" ||
    run.reservedCalls !== 0 ||
    run.state !== "completed" ||
    job.target_hash !== expected.targetHash ||
    s.sqlite.prepare("SELECT 1 FROM external_attempts WHERE run_id=?").get(run.id)
  )
    throw new FullBookExecutionError("history")
  return receipt
}
