import { randomUUID } from "node:crypto"
import { FullBookManagedConsent } from "@reading-studio/contracts"
import { openStorage } from "@reading-studio/storage"
import { FixtureDatabase } from "@reading-studio/storage/test-support"
import { z } from "zod"

const [databasePath, privateDataRoot, consentId, nativeId, now, expiresAt] = z
  .array(z.string())
  .length(6)
  .parse(process.argv.slice(2))
if (
  !databasePath ||
  !privateDataRoot ||
  !consentId ||
  !nativeId ||
  !now ||
  !expiresAt ||
  !process.send
)
  throw new TypeError("Invalid isolated race fixture")
const send = process.send.bind(process)
const probe = new FixtureDatabase(databasePath, { readonly: true, fileMustExist: true })
try {
  const row = z
    .object({ record_json: z.string() })
    .parse(
      probe.prepare("SELECT record_json FROM full_book_managed_consents WHERE id=?").get(nativeId),
    )
  if (
    FullBookManagedConsent.parse(JSON.parse(row.record_json)).policy.build.kind !==
    "fixture-not-live-evidence"
  )
    throw new TypeError("Only disposable synthetic scope is allowed")
} finally {
  probe.close()
}
const storage = openStorage({ databasePath, privateDataRoot })
process.once("message", (message) => {
  try {
    if (message !== "start") throw new TypeError("Missing race barrier")
    const lease = storage.fullBookExecution.claim({
      consentId,
      token: randomUUID(),
      now,
      expiresAt,
    })
    if (lease) {
      const prepared = storage.fullBookExecution.reserve({
        lease,
        now,
        threadId: "unstarted",
        rpcId: 1,
      })
      storage.fullBookExecution.interrupt({ lease, attemptId: prepared.attempt.id })
    }
    storage.close()
    send({ stage: "result", claimed: lease !== null }, () => process.disconnect())
  } catch (error) {
    storage.close()
    send(
      {
        stage: "error",
        category: error instanceof Error ? "fixture-operation-failed" : "fixture-unknown-failure",
      },
      () => process.disconnect(),
    )
  }
})
send({ stage: "ready" })
