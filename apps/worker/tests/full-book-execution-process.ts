import { randomUUID } from "node:crypto"
import { assertNever } from "@reading-studio/contracts"
import { openStorage } from "@reading-studio/storage"
import { z } from "zod"
import { executionClock as clock, syntheticReplyMetadata } from "./full-book-execution-fixture.ts"
import { pluralMapOutput } from "./full-book-test-fixture.ts"

async function send(message: Readonly<Record<string, unknown>>) {
  await new Promise<void>((resolve, reject) => {
    if (!process.send) {
      reject(new TypeError("Synthetic worker requires IPC"))
      return
    }
    process.send(message, (error) => (error ? reject(error) : resolve()))
  })
}
const options = z
  .strictObject({ databasePath: z.string(), privateDataRoot: z.string() })
  .parse(JSON.parse(process.argv[2] ?? "null"))
const consentId = z.uuid().parse(process.argv[3]),
  mode = z.enum(["race", "before-write", "received"]).parse(process.argv[4])
const storage = openStorage(options)
try {
  await send({ kind: "ready" })
  z.literal("start").parse(await new Promise((resolve) => process.once("message", resolve)))
  const lease = storage.fullBookExecution.claim({
    consentId,
    token: randomUUID(),
    now: clock.now,
    expiresAt: clock.expiresAt,
  })
  if (!lease) await send({ kind: "result", claimed: false })
  else {
    const prepared = storage.fullBookExecution.reserve({
      lease,
      now: clock.now,
      threadId: "synthetic-thread",
      rpcId: 1,
    })
    switch (mode) {
      case "race":
        await send({ kind: "result", claimed: true, attemptId: prepared.attempt.id })
        break
      case "before-write":
        storage.fullBookExecution.beforeWrite({
          lease,
          attemptId: prepared.attempt.id,
          now: clock.now,
        })
        await send({ kind: "checkpoint", boundary: "before-write", attemptId: prepared.attempt.id })
        await new Promise((resolve) => process.once("message", resolve))
        break
      case "received": {
        storage.fullBookExecution.beforeWrite({
          lease,
          attemptId: prepared.attempt.id,
          now: clock.now,
        })
        const consent = storage.fullBookConsent.read(consentId)
        storage.fullBookExecution.receive({
          attemptId: prepared.attempt.id,
          dispatchKey: prepared.wire.dispatchKey,
          serialized: JSON.stringify(pluralMapOutput(consent.session)),
          receivedAt: clock.now,
          usage: { kind: "known", inputTokens: 11, outputTokens: 6 },
          metadata: syntheticReplyMetadata(prepared.wire),
        })
        await send({ kind: "checkpoint", boundary: "received", attemptId: prepared.attempt.id })
        await new Promise((resolve) => process.once("message", resolve))
        break
      }
      default:
        assertNever(mode)
    }
  }
} finally {
  storage.close()
  process.disconnect?.()
}
