import { realpathSync } from "node:fs"
import { basename, dirname } from "node:path"
import {
  contentDigest,
  FullBookConsentError,
  FullBookManagedConsent,
  fullBookManagedThread,
  LocalSubscriptionSession,
  localToolInput,
  sameSubscriptionDestination,
  subscriptionDestination,
} from "@reading-studio/contracts"
import { z } from "zod"
import type { StorageContext } from "./database.ts"
import type { FullBookConsentRepository } from "./full-book-consent.ts"
import { requireManagedAttempt } from "./full-book-managed-attempt.ts"
import { recordManagedFailure, revokeManagedConsent } from "./full-book-managed-evidence.ts"
import {
  exportManagedHistory,
  inspectManagedConsent,
  managedConsentHistory,
} from "./full-book-managed-history.ts"
import { ManagedFrame, ManagedFrameRecord } from "./full-book-managed-record.ts"
import { readFullBookRecovery } from "./full-book-recovery-read.ts"
import { validateManagedReview } from "./full-book-review-binding.ts"
import { serializeRpcFrame } from "./rpc-frame.ts"

export class FullBookManagedConsents {
  constructor(
    private readonly context: StorageContext,
    private readonly budgets: FullBookConsentRepository,
  ) {}
  private validate(grant: FullBookManagedConsent) {
    const budget = this.budgets.read(grant.budgetConsentId),
      session = budget.session,
      settings = session.settings
    validateManagedReview(grant, budget)
    if (
      contentDigest(JSON.stringify(budget)) !== grant.budgetBinding ||
      grant.policy.maxFrameBytes !== session.input.policy.maxAppBytes ||
      settings.temperature !== 0 ||
      settings.topP !== 1 ||
      settings.seed !== null ||
      settings.reasoningEffort !== "default"
    )
      throw new FullBookConsentError("authority")
    const row = z
      .object({ record_json: z.string() })
      .safeParse(
        this.context.sqlite
          .prepare(
            "SELECT record_json FROM subscription_sessions WHERE installation_id=? AND provider='chatgpt-subscription'",
          )
          .get(session.destination.installationId),
      )
    if (!row.success) throw new FullBookConsentError("authority")
    const observed = LocalSubscriptionSession.parse(JSON.parse(row.data.record_json)),
      destination = subscriptionDestination(
        "chatgpt-subscription",
        session.destination.installationId,
        observed,
      )
    if (
      !destination ||
      observed.catalog !== "checked" ||
      !observed.models.some((model) => model.model === session.model) ||
      !sameSubscriptionDestination(destination, session.destination)
    )
      throw new FullBookConsentError("authority")
    const recovery = readFullBookRecovery(this.context.sqlite, budget)
    if (recovery && recovery.amendment.nativeConsentId !== grant.id)
      throw new FullBookConsentError("authority")
    return { grant, budget, recovery }
  }
  approve(value: unknown): FullBookManagedConsent {
    const grant = FullBookManagedConsent.parse(value)
    return this.context.sqlite
      .transaction(() => {
        this.validate(grant)
        this.context.sqlite
          .prepare("INSERT INTO full_book_managed_consents VALUES (?,?,?)")
          .run(grant.id, grant.budgetConsentId, JSON.stringify(grant))
        return grant
      })
      .immediate()
  }
  read(id: string) {
    return this.context.sqlite.transaction(() => {
      const row = z
        .object({ record_json: z.string() })
        .parse(
          this.context.sqlite
            .prepare("SELECT record_json FROM full_book_managed_consents WHERE id=?")
            .get(id),
        )
      const grant = FullBookManagedConsent.parse(JSON.parse(row.record_json))
      if (
        grant.id !== id ||
        this.context.sqlite
          .prepare("SELECT 1 FROM full_book_managed_revocations WHERE consent_id=?")
          .get(id)
      )
        throw new FullBookConsentError("authority")
      return this.validate(grant)
    })()
  }
  revoke(id: string, reason: string) {
    revokeManagedConsent(this.context, id, reason)
  }
  inspect(scope: Readonly<{ id: string; owner: string; setupId: string }>) {
    return inspectManagedConsent(this.context, scope)
  }
  history(owner: string, setupId: string) {
    return managedConsentHistory(this.context, owner, setupId)
  }
  exportHistory(scope: Readonly<{ id: string; owner: string; setupId: string }>) {
    return exportManagedHistory(this.context, scope)
  }
  recordFrames(id: string, attemptId: string, value: unknown) {
    return this.context.sqlite
      .transaction(() => {
        const authorized = this.read(id)
        const frame = ManagedFrameRecord.parse(value)
        this.requireAttempt(authorized.budget.id, attemptId, frame.recordedAt)
        const bootstrap = z
          .object({ record_json: z.string() })
          .parse(
            this.context.sqlite
              .prepare(
                "SELECT record_json FROM full_book_managed_threads WHERE attempt_id=? AND consent_id=?",
              )
              .get(attemptId, id),
          )
        if (bootstrap.record_json !== JSON.stringify(frame.thread))
          throw new FullBookConsentError("authority")
        const wire = z
          .object({ record_json: z.string() })
          .parse(
            this.context.sqlite
              .prepare("SELECT record_json FROM full_book_wires WHERE attempt_id=?")
              .get(attemptId),
          )
        const expected = z
          .object({
            serialized: z.string(),
            hash: z.string(),
            bytes: z.number(),
            targetHash: z.string(),
          })
          .parse(JSON.parse(wire.record_json))
        const request = z
          .object({
            model: z.string(),
            prompt: z.string(),
            schema: z.record(z.string(), z.unknown()),
          })
          .parse(
            JSON.parse(
              z.object({ requestJson: z.string() }).parse(JSON.parse(wire.record_json)).requestJson,
            ),
          )
        const actual = serializeRpcFrame({
          provider: "chatgpt-subscription",
          id: frame.turn.id,
          method: "turn/start",
          params: {
            threadId: frame.freshThreadId,
            ...localToolInput("chatgpt-subscription", request),
          },
          binding: expected.targetHash,
        })
        const thread = z
          .object({ params: z.object({ cwd: z.string() }) })
          .parse(JSON.parse(frame.thread.serialized))
        const setup = serializeRpcFrame({
          provider: "chatgpt-subscription",
          id: frame.thread.id,
          method: "thread/start",
          params: fullBookManagedThread(request.model, thread.params.cwd),
          binding: expected.targetHash,
        })
        if (
          request.model !== authorized.budget.session.model ||
          frame.turn.method !== "turn/start" ||
          frame.thread.method !== "thread/start" ||
          frame.turn.serialized !== actual.serialized ||
          frame.turn.sha256 !== actual.sha256 ||
          frame.turn.bytes !== actual.bytes ||
          frame.turn.binding !== expected.targetHash ||
          frame.thread.serialized !== setup.serialized ||
          frame.thread.sha256 !== setup.sha256 ||
          frame.thread.bytes !== setup.bytes ||
          frame.policyHash !== contentDigest(JSON.stringify(authorized.grant.policy)) ||
          frame.buildKind !== authorized.grant.policy.build.kind ||
          frame.thread.bytes + frame.turn.bytes > authorized.grant.policy.maxFrameBytes
        )
          throw new FullBookConsentError("authority")
        this.context.sqlite
          .prepare("INSERT INTO full_book_managed_frames VALUES (?,?,?)")
          .run(attemptId, id, JSON.stringify(frame))
        return frame
      })
      .immediate()
  }
  recordThread(id: string, attemptId: string, value: unknown) {
    const parsed = z
        .strictObject({ frame: ManagedFrame, recordedAt: z.iso.datetime() })
        .parse(value),
      { frame } = parsed
    this.context.sqlite
      .transaction(() => {
        const { grant, budget } = this.read(id)
        const attempt = this.requireAttempt(budget.id, attemptId, parsed.recordedAt)
        const raw = z
          .object({ params: z.object({ cwd: z.string() }) })
          .parse(JSON.parse(frame.serialized))
        const expected = serializeRpcFrame({
          provider: "chatgpt-subscription",
          id: frame.id,
          method: "thread/start",
          params: fullBookManagedThread(budget.session.model, raw.params.cwd),
          binding: frame.binding,
        })
        if (
          frame.binding !== attempt.target_hash ||
          frame.method !== "thread/start" ||
          !basename(raw.params.cwd).startsWith("tenjinsan-study-") ||
          dirname(raw.params.cwd) !== realpathSync("/tmp") ||
          frame.serialized !== expected.serialized ||
          frame.sha256 !== expected.sha256 ||
          frame.bytes > grant.policy.maxFrameBytes
        )
          throw new FullBookConsentError("authority")
        this.context.sqlite
          .prepare("INSERT INTO full_book_managed_threads VALUES (?,?,?)")
          .run(attemptId, id, JSON.stringify(frame))
      })
      .immediate()
  }
  private requireAttempt(budgetId: string, attemptId: string, now: string) {
    return requireManagedAttempt(this.context, { budgetId, attemptId, now })
  }
  failure(id: string, attemptId: string, value: unknown) {
    recordManagedFailure(this.context, { id, attemptId, value })
  }
}
export { ManagedFrameRecord } from "./full-book-managed-record.ts"
