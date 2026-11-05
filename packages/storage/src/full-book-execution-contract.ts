import { AttemptId, Digest, Timestamp, Usage } from "@reading-studio/contracts"
import { z } from "zod"

export const FullBookLease = z
  .strictObject({
    consentId: z.uuid(),
    jobId: Digest,
    nodeIndex: z.number().int().nonnegative(),
    targetHash: Digest,
    token: z.uuid(),
    fence: z.number().int().positive(),
    expiresAt: Timestamp,
  })
  .readonly()
export type FullBookLease = z.infer<typeof FullBookLease>
export const FullBookWire = z
  .strictObject({
    attemptId: AttemptId,
    jobId: Digest,
    targetHash: Digest,
    ordinal: z.number().int().min(1).max(3),
    recoveryId: z.uuid().optional(),
    dispatchKey: z.uuid(),
    threadId: z.string().min(1).max(256),
    rpcId: z.number().int().positive(),
    leaseToken: z.uuid(),
    leaseFence: z.number().int().positive(),
    repair: z.boolean(),
    requestJson: z.string(),
    requestHash: Digest,
    serialized: z.string(),
    hash: Digest,
    bytes: z.number().int().nonnegative(),
    transport: z.literal("synthetic-only-no-native-entry"),
  })
  .refine(
    (wire) => (wire.ordinal === 3 ? wire.recoveryId !== undefined : wire.recoveryId === undefined),
    "third wire requires owner recovery identity",
  )
  .readonly()
export type FullBookWire = z.infer<typeof FullBookWire>
export const ClaimInput = z.strictObject({
  consentId: z.uuid(),
  token: z.uuid(),
  now: Timestamp,
  expiresAt: Timestamp,
})
export const ReserveInput = z.strictObject({
  lease: FullBookLease,
  now: Timestamp,
  threadId: z.string().min(1).max(256),
  rpcId: z.number().int().positive(),
})
export const AttemptClaimInput = z.strictObject({
  lease: FullBookLease,
  attemptId: AttemptId,
  now: Timestamp,
})
export const FullBookReplyMetadata = z
  .strictObject({
    transport: z.enum(["synthetic-only-no-native-entry", "managed-experimental-app-bounded"]),
    threadId: z.string().min(1).max(256),
    requestId: z.number().int().positive(),
    wireHash: Digest,
    targetHash: Digest,
    turnId: z.string().min(1).max(256),
    terminal: z.enum(["completed", "failed", "interrupted"]),
  })
  .readonly()
export const ReplyInput = z.strictObject({
  attemptId: AttemptId,
  dispatchKey: z.uuid(),
  serialized: z.string(),
  usage: Usage,
  receivedAt: Timestamp,
  metadata: FullBookReplyMetadata,
})
export class FullBookExecutionError extends Error {
  constructor(
    readonly reason: "disabled" | "lease" | "binding" | "budget" | "unknown" | "state" | "history",
  ) {
    super(`Full-book execution refused: ${reason}`)
    this.name = "FullBookExecutionError"
  }
}
