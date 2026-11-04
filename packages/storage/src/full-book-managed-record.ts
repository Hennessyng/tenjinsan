import type Database from "better-sqlite3"
import { z } from "zod"
import type { FullBookWire } from "./full-book-execution-contract.ts"
export const ManagedFrame = z
  .strictObject({
    version: z.literal("app-rpc-frame-1"),
    provider: z.literal("chatgpt-subscription"),
    id: z.number().int().positive(),
    method: z.string(),
    binding: z.string().nullable(),
    serialized: z.string(),
    bytes: z.number().int().positive(),
    sha256: z.string(),
  })
  .readonly()
export const ManagedFrameRecord = z
  .strictObject({
    evidence: z.literal("experimental-app-bounded"),
    thread: ManagedFrame,
    turn: ManagedFrame,
    buildKind: z.enum(["pinned-codex", "fixture-not-live-evidence"]),
    policyHash: z.string(),
    freshThreadId: z.string(),
    recordedAt: z.iso.datetime(),
  })
  .readonly()
export function managedReplyCoordinates(sqlite: Database.Database, wire: FullBookWire) {
  const row = sqlite
    .prepare("SELECT record_json FROM full_book_managed_frames WHERE attempt_id=?")
    .get(wire.attemptId)
  if (!row)
    return {
      transport: "synthetic-only-no-native-entry",
      threadId: wire.threadId,
      requestId: wire.rpcId,
      wireHash: wire.hash,
      targetHash: wire.targetHash,
    } as const
  const record = ManagedFrameRecord.parse(
    JSON.parse(z.object({ record_json: z.string() }).parse(row).record_json),
  )
  return {
    transport: "managed-experimental-app-bounded",
    threadId: record.freshThreadId,
    requestId: record.turn.id,
    wireHash: record.turn.sha256,
    targetHash: wire.targetHash,
  } as const
}
