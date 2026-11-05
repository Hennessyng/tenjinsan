import { randomUUID } from "node:crypto"
import { FullBookConsentError } from "@reading-studio/contracts"
import {
  FullBookLease,
  fullBookNativeReleased,
  fullBookNativeScope,
  type Storage,
} from "@reading-studio/storage"
import { type FullBookRunScope, fullBookRunState } from "./full-book-run-state.ts"
import { type FullBookServerRuntime, inspectFullBookRuntime } from "./full-book-runtime.ts"

export class FullBookLifecycle {
  private readonly active = new Map<string, AbortController>()
  constructor(
    private readonly storage: Storage,
    private readonly runtime: FullBookServerRuntime | undefined,
  ) {}
  private executable(scope: FullBookRunScope) {
    const pair = this.storage.fullBookManagedConsents.inspect(scope),
      { grant } = pair
    return (
      fullBookNativeReleased(grant.policy.build, fullBookNativeScope(pair)) ||
      (grant.policy.build.kind === "fixture-not-live-evidence" &&
        this.runtime?.execute !== undefined)
    )
  }
  state(scope: FullBookRunScope) {
    return this.storage.atomicWrite(() => {
      const record = this.storage.fullBookManagedConsents.inspect(scope)
      let authority = false
      if (!record.revoked && !record.closed && record.grant.reviewAcknowledgement) {
        try {
          this.storage.fullBookManagedConsents.read(scope.id)
          const options = {
            mode: "full-book-test-1" as const,
            policy: record.budget.session.input.policy,
            sourceCeiling: record.recovery?.effectiveCeiling ?? record.budget.sourceCeiling,
            collectorBytes: record.grant.policy.collectorBytes,
            timeoutMs: record.grant.policy.timeoutMs,
          }
          authority =
            inspectFullBookRuntime(this.runtime, options)?.binding ===
            record.grant.reviewAcknowledgement.runtimeBinding
        } catch (error) {
          if (!(error instanceof FullBookConsentError)) throw error
        }
      }
      return fullBookRunState(this.storage, scope, {
        active: this.active.has(scope.id),
        executable: authority && this.executable(scope),
        authority,
      })
    })
  }
  history(owner: string, setupId: string) {
    return this.storage.fullBookManagedConsents
      .history(owner, setupId)
      .map((record) => this.state({ owner, setupId, id: record.grant.id }))
  }
  async resume(scope: FullBookRunScope) {
    const s = this.storage,
      record = s.fullBookManagedConsents.inspect(scope)
    if (!record.grant.reviewAcknowledgement || record.revoked || record.closed)
      throw new FullBookConsentError("authority")
    s.fullBookManagedConsents.read(scope.id)
    if (record.recovery?.state === "consumed") throw new FullBookConsentError("disabled")
    if (record.grant.policy.build.kind === "pinned-codex" && !this.executable(scope))
      throw new FullBookConsentError("disabled")
    if (this.active.has(scope.id)) return this.state(scope)
    s.fullBookExecution.recover({ consentId: record.budget.id, now: new Date().toISOString() })
    const current = s.fullBookManagedConsents.inspect(scope),
      attempts = s.fullBookExecution.attempts(current.budget.id)
    if (
      attempts.some(
        (attempt) =>
          attempt.state === "outcome_unknown" &&
          attempt.resolution === "awaiting-owner" &&
          !(
            current.recovery?.state === "pending" &&
            current.recovery.amendment.priorAttemptIds.includes(attempt.id)
          ),
      )
    )
      throw new FullBookConsentError("inflight")
    const options = {
      mode: "full-book-test-1" as const,
      policy: current.budget.session.input.policy,
      sourceCeiling: current.recovery?.effectiveCeiling ?? current.budget.sourceCeiling,
      collectorBytes: current.grant.policy.collectorBytes,
      timeoutMs: current.grant.policy.timeoutMs,
    }
    if (
      inspectFullBookRuntime(this.runtime, options)?.binding !==
      current.grant.reviewAcknowledgement?.runtimeBinding
    )
      throw new FullBookConsentError("authority")
    const received = current.jobs.find(
      (job) =>
        job.state !== "completed" &&
        job.repair === 0 &&
        attempts.some(
          (attempt) => attempt.runId === job.run_id && attempt.state === "response-received",
        ),
    )
    if (received) {
      const attempt = attempts.find(
        (attempt) => attempt.runId === received.run_id && attempt.state === "response-received",
      )
      const now = new Date().toISOString(),
        lease =
          received.state === "running"
            ? FullBookLease.parse({
                consentId: current.budget.id,
                jobId: received.id,
                nodeIndex: received.node_index,
                targetHash: received.target_hash,
                token: received.token,
                fence: received.fence,
                expiresAt: received.expires_at,
              })
            : s.fullBookExecution.claim({
                consentId: current.budget.id,
                token: randomUUID(),
                now,
                expiresAt: new Date(Date.now() + 30000).toISOString(),
              })
      if (!lease || !attempt) throw new FullBookConsentError("authority")
      s.fullBookExecution.accept({ lease, attemptId: attempt.id, now })
      return this.state(scope)
    }
    if (!this.executable(scope)) throw new FullBookConsentError("disabled")
    const controller = new AbortController()
    this.active.set(scope.id, controller)
    try {
      if (this.runtime?.execute && current.grant.policy.build.kind === "fixture-not-live-evidence")
        await this.runtime.execute(scope.id, controller.signal)
      else
        await s.fullBookManaged.run(scope.id, {
          signal: controller.signal,
          now: () => new Date().toISOString(),
        })
    } catch (error) {
      if (!(error instanceof Error)) throw error
      const saved = s.fullBookManagedConsents.inspect(scope)
      if (saved.revoked || saved.closed) return this.state(scope)
      throw error
    } finally {
      this.active.delete(scope.id)
    }
    return this.state(scope)
  }
  cancel(scope: FullBookRunScope) {
    this.storage.atomicWrite(() => {
      const record = this.storage.fullBookManagedConsents.inspect(scope)
      if (!record.revoked)
        this.storage.fullBookManagedConsents.revoke(
          scope.id,
          "Owner cancelled experimental analysis",
        )
      this.storage.fullBookExecution.cancel(
        record.budget.id,
        "Owner cancelled experimental analysis",
      )
    })
    this.active.get(scope.id)?.abort()
    return this.state(scope)
  }
  decide(scope: FullBookRunScope, attemptId: string, decision: "retry" | "stop") {
    const record = this.storage.fullBookManagedConsents.inspect(scope)
    if (
      !this.storage.fullBookExecution
        .attempts(record.budget.id)
        .some((attempt) => attempt.id === attemptId)
    )
      throw new FullBookConsentError("authority")
    if (decision === "stop") return this.cancel(scope)
    this.storage.fullBookManagedConsents.read(scope.id)
    this.storage.fullBookExecution.resolve({ attemptId, decision })
    return this.state(scope)
  }
}
