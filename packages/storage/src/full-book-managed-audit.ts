import {
  contentDigest,
  FullBookManagedConsent,
  FullBookTestConsent,
  fullBookManagedThread,
  localToolInput,
  Usage,
} from "@reading-studio/contracts"
import { z } from "zod"
import { BackupError } from "./backup-schema.ts"
import { FullBookWire } from "./full-book-execution-contract.ts"
import { ManagedDiagnostic } from "./full-book-managed-diagnostic.ts"
import { ManagedFrame, ManagedFrameRecord } from "./full-book-managed-record.ts"
import type { FullBookAudit } from "./full-book-portable-schema.ts"
import { serializeRpcFrame } from "./rpc-frame.ts"

export function auditReplyCoordinates(audit: FullBookAudit, wire: FullBookWire) {
  const raw = audit.managed?.frames.find((row) => row["attempt_id"] === wire.attemptId)
  if (!raw)
    return {
      transport: "synthetic-only-no-native-entry",
      threadId: wire.threadId,
      requestId: wire.rpcId,
      wireHash: wire.hash,
      targetHash: wire.targetHash,
    } as const
  const frame = ManagedFrameRecord.parse(JSON.parse(z.string().parse(raw["record_json"])))
  return {
    transport: "managed-experimental-app-bounded",
    threadId: frame.freshThreadId,
    requestId: frame.turn.id,
    wireHash: frame.turn.sha256,
    targetHash: wire.targetHash,
  } as const
}
export function validateManagedAudit(audit: FullBookAudit) {
  if (!audit.managed) return
  const native = audit.managed,
    budget = FullBookTestConsent.parse(JSON.parse(z.string().parse(audit.consent["record_json"])))
  const grants = new Map(
    native.consents.map((row) => {
      const grant = FullBookManagedConsent.parse(JSON.parse(z.string().parse(row["record_json"])))
      if (
        grant.id !== row["id"] ||
        row["budget_consent_id"] !== budget.id ||
        grant.budgetConsentId !== budget.id ||
        grant.budgetBinding !== contentDigest(JSON.stringify(budget))
      )
        throw new BackupError("managed historical consent binding")
      return [grant.id, grant] as const
    }),
  )
  if (grants.size !== native.consents.length)
    throw new BackupError("duplicate managed authorization")
  const seen = new Set<string>()
  for (const row of native.threads) {
    const id = z.string().parse(row["attempt_id"]),
      grant = grants.get(z.string().parse(row["consent_id"]))
    const frame = ManagedFrame.parse(JSON.parse(z.string().parse(row["record_json"])))
    const wireRow = audit.wires.find((row) => row["attempt_id"] === id)
    if (!grant || !wireRow || seen.has(id)) throw new BackupError("managed bootstrap reference")
    seen.add(id)
    const wire = FullBookWire.parse(JSON.parse(z.string().parse(wireRow["record_json"])))
    const params = z
      .object({ params: z.object({ cwd: z.string() }) })
      .parse(JSON.parse(frame.serialized)).params
    const expected = serializeRpcFrame({
      provider: "chatgpt-subscription",
      id: frame.id,
      method: "thread/start",
      params: fullBookManagedThread(budget.session.model, params.cwd),
      binding: wire.targetHash,
    })
    if (
      frame.serialized !== expected.serialized ||
      frame.sha256 !== expected.sha256 ||
      frame.bytes !== expected.bytes ||
      frame.bytes > grant.policy.maxFrameBytes
    )
      throw new BackupError("managed bootstrap bytes/policy")
  }
  const turns = new Set<string>()
  for (const row of native.frames) {
    const id = z.string().parse(row["attempt_id"]),
      grant = grants.get(z.string().parse(row["consent_id"]))
    const frame = ManagedFrameRecord.parse(JSON.parse(z.string().parse(row["record_json"])))
    const bootstrap = native.threads.find((row) => row["attempt_id"] === id),
      wireRow = audit.wires.find((row) => row["attempt_id"] === id)
    if (!grant || !bootstrap || !wireRow || turns.has(frame.freshThreadId))
      throw new BackupError("managed historical frame reference")
    turns.add(frame.freshThreadId)
    const wire = FullBookWire.parse(JSON.parse(z.string().parse(wireRow["record_json"])))
    const request = z
      .object({ model: z.string(), prompt: z.string(), schema: z.record(z.string(), z.unknown()) })
      .parse(JSON.parse(wire.requestJson))
    const expected = serializeRpcFrame({
      provider: "chatgpt-subscription",
      id: frame.turn.id,
      method: "turn/start",
      params: { threadId: frame.freshThreadId, ...localToolInput("chatgpt-subscription", request) },
      binding: wire.targetHash,
    })
    if (
      JSON.stringify(frame.thread) !== bootstrap["record_json"] ||
      frame.policyHash !== contentDigest(JSON.stringify(grant.policy)) ||
      frame.buildKind !== grant.policy.build.kind ||
      frame.turn.serialized !== expected.serialized ||
      frame.turn.sha256 !== expected.sha256 ||
      frame.turn.bytes !== expected.bytes ||
      frame.thread.bytes + frame.turn.bytes > grant.policy.maxFrameBytes
    )
      throw new BackupError("managed historical wire bytes/policy")
  }
  for (const row of native.failures) {
    if (
      !grants.has(z.string().parse(row["consent_id"])) ||
      !audit.attempts.some((attempt) => attempt["id"] === row["attempt_id"])
    )
      throw new BackupError("managed failure reference")
    z.strictObject({
      reason: z.string(),
      observedUsage: Usage,
      collectedBytes: z.number().int().nonnegative(),
      partialAccepted: z.literal(false),
      diagnostic: ManagedDiagnostic.optional(),
    }).parse(JSON.parse(z.string().parse(row["record_json"])))
  }
  for (const row of native.revocations)
    if (!grants.has(z.string().parse(row["consent_id"])))
      throw new BackupError("managed revocation reference")
}
