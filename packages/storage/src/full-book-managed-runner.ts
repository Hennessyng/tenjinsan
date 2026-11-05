import { createHash, randomUUID } from "node:crypto"
import { readFileSync, realpathSync } from "node:fs"
import {
  contentDigest,
  FULL_BOOK_MANAGED_PROFILE,
  FullBookConsentError,
  fullBookManagedThread,
  localToolInput,
  sameSubscriptionDestination,
  subscriptionDestination,
} from "@reading-studio/contracts"
import { z } from "zod"
import type { FullBookExecutionRepository } from "./full-book-execution.ts"
import type { FullBookManagedConsents } from "./full-book-managed-consent.ts"
import { managedFailureDiagnostic } from "./full-book-managed-failure.ts"
import { collectManagedTurn, ManagedCollectionError } from "./full-book-managed-stream.ts"
import { fullBookNativeReleased, fullBookNativeScope } from "./full-book-release.ts"
import { safeMethod } from "./protocol-observation.ts"
import type { SubscriptionLogin } from "./subscription-login.ts"
import { SubscriptionRpcFault } from "./subscription-rpc-fault.ts"

export class FullBookManagedRunner {
  constructor(
    private readonly deps: Readonly<{
      grants: FullBookManagedConsents
      execution: FullBookExecutionRepository
      login: SubscriptionLogin
    }>,
  ) {}
  async run(id: string, input: Readonly<{ signal: AbortSignal; now: () => string }>) {
    const { grant, budget, recovery } = this.deps.grants.read(id),
      { policy } = grant
    if (recovery?.state === "consumed") throw new FullBookConsentError("disabled")
    if (
      policy.build.kind === "pinned-codex" &&
      (!fullBookNativeReleased(policy.build, fullBookNativeScope({ grant, budget })) ||
        !grant.reviewAcknowledgement ||
        budget.session.input.hierarchyPolicy !== "direct-children-2")
    )
      throw new FullBookConsentError("disabled")
    if (input.signal.aborted) return { kind: "unstarted" as const }
    const binary = process.env["STUDIO_SUBSCRIPTION_CODEX_BINARY"]
    if (!binary || realpathSync(binary) !== realpathSync(policy.build.binaryPath))
      throw new FullBookConsentError("authority")
    if (createHash("sha256").update(readFileSync(binary)).digest("hex") !== policy.build.sha256)
      throw new FullBookConsentError("authority")
    const now = input.now(),
      lease = this.deps.execution.claim({
        consentId: budget.id,
        token: randomUUID(),
        now,
        expiresAt: new Date(Date.parse(now) + policy.timeoutMs + 30_000).toISOString(),
      })
    if (!lease) return { kind: "idle" as const }
    const prepared = this.deps.execution.reserve({
      lease,
      now,
      threadId: `unstarted-${grant.id}`,
      rpcId: 1,
    })
    this.deps.execution.beforeWrite({ lease, attemptId: prepared.attempt.id, now: input.now() })
    try {
      return await this.deps.login.withSession(
        budget.session.destination.installationId,
        async (session) => {
          this.deps.grants.read(id)
          const destination = subscriptionDestination(
            "chatgpt-subscription",
            budget.session.destination.installationId,
            session.state,
          )
          if (
            !destination ||
            !sameSubscriptionDestination(destination, budget.session.destination) ||
            !session.rpc.profileAllowed()
          )
            throw new FullBookConsentError("authority")
          const rpc = session.rpc
          const authorize = () => {
            if (input.signal.aborted)
              throw new ManagedCollectionError("cancelled", { kind: "unknown" }, { bytes: 0 })
            this.deps.grants.read(id)
            if (!rpc.profileAllowed() || rpc.clientRequestRejected)
              throw new FullBookConsentError("authority")
          }
          authorize()
          const mcp = z
            .object({ data: z.array(z.unknown()).length(0), nextCursor: z.null() })
            .parse(await rpc.request("mcpServerStatus/list", {}))
          void mcp
          let badEvent = false
          const watch = rpc.subscribe((method) => {
            if (
              method === "thread/environment/connected" ||
              method.startsWith("hook/") ||
              method.startsWith("command/")
            ) {
              badEvent = true
              rpc.stop(
                new SubscriptionRpcFault("runner-authority", undefined, {
                  method: safeMethod(method),
                }),
              )
            }
          })
          try {
            const thread = rpc.prepareRequest(
              "thread/start",
              fullBookManagedThread(budget.session.model, rpc.cwd),
              lease.targetHash,
            )
            if (thread.bytes > policy.maxFrameBytes) throw new FullBookConsentError("authority")
            authorize()
            this.deps.grants.recordThread(id, prepared.attempt.id, {
              frame: thread,
              recordedAt: input.now(),
            })
            const started = z
              .object({
                model: z.string(),
                modelProvider: z.literal("openai"),
                cwd: z.string(),
                instructionSources: z.array(z.unknown()).length(0),
                runtimeWorkspaceRoots: z.array(z.unknown()).length(0),
                approvalPolicy: z.literal("never"),
                activePermissionProfile: z.object({ id: z.literal(FULL_BOOK_MANAGED_PROFILE) }),
                sandbox: z.object({ type: z.literal("readOnly"), networkAccess: z.literal(false) }),
                thread: z.object({ id: z.string(), turns: z.array(z.unknown()).length(0) }),
              })
              .parse(
                await rpc.requestPrepared(thread, policy.timeoutMs, {
                  maxBytes: policy.maxFrameBytes,
                  expectedBinding: lease.targetHash,
                }),
              )
            if (
              badEvent ||
              started.model !== budget.session.model ||
              started.cwd !== rpc.cwd ||
              rpc.clientRequestRejected
            )
              throw new FullBookConsentError("authority")
            const request = z
              .object({
                model: z.string(),
                prompt: z.string(),
                schema: z.record(z.string(), z.unknown()),
              })
              .parse(JSON.parse(prepared.wire.requestJson))
            const turn = rpc.prepareRequest(
              "turn/start",
              { threadId: started.thread.id, ...localToolInput("chatgpt-subscription", request) },
              lease.targetHash,
            )
            this.deps.grants.recordFrames(id, prepared.attempt.id, {
              evidence: "experimental-app-bounded",
              thread,
              turn,
              buildKind: policy.build.kind,
              policyHash: contentDigest(JSON.stringify(policy)),
              freshThreadId: started.thread.id,
              recordedAt: input.now(),
            })
            authorize()
            const output = await collectManagedTurn({
              rpc,
              frame: turn,
              threadId: started.thread.id,
              signal: input.signal,
              timeoutMs: policy.timeoutMs,
              collectorBytes: policy.collectorBytes,
              maxBytes: policy.maxFrameBytes - thread.bytes,
            })
            if (badEvent || rpc.clientRequestRejected)
              throw new ManagedCollectionError("protocol", output.usage, {
                bytes: Buffer.byteLength(output.text, "utf8"),
                diagnostic: {
                  category: "transport",
                  stage: "rpc",
                  site: "runner-postflight",
                  fields: [],
                  transport: rpc.observation(),
                },
              })
            this.deps.execution.receive({
              attemptId: prepared.attempt.id,
              dispatchKey: prepared.wire.dispatchKey,
              serialized: output.text,
              usage: output.usage,
              receivedAt: input.now(),
              metadata: {
                transport: "managed-experimental-app-bounded",
                threadId: started.thread.id,
                requestId: turn.id,
                wireHash: turn.sha256,
                targetHash: lease.targetHash,
                turnId: output.turnId,
                terminal: "completed",
              },
            })
            return {
              ...this.deps.execution.accept({
                lease,
                attemptId: prepared.attempt.id,
                now: input.now(),
              }),
              evidence: "experimental-app-bounded" as const,
              buildKind: policy.build.kind,
            }
          } finally {
            watch()
          }
        },
        policy.build.kind === "fixture-not-live-evidence",
      )
    } catch (error) {
      this.deps.grants.failure(id, prepared.attempt.id, {
        reason: error instanceof ManagedCollectionError ? error.reason : "setup-or-io",
        observedUsage: error instanceof ManagedCollectionError ? error.usage : { kind: "unknown" },
        collectedBytes: error instanceof ManagedCollectionError ? error.bytes : 0,
        partialAccepted: false,
        diagnostic: managedFailureDiagnostic(error),
      })
      this.deps.execution.interrupt({ lease, attemptId: prepared.attempt.id })
      if (!(error instanceof Error)) throw error
      return {
        kind: "outcome-unknown" as const,
        evidence: "experimental-app-bounded" as const,
        observedUsage:
          error instanceof ManagedCollectionError ? error.usage : { kind: "unknown" as const },
        reason:
          error instanceof ManagedCollectionError
            ? error.message
            : "Managed experimental setup failed",
      }
    }
  }
}
