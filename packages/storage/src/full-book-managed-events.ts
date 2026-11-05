import type { Usage } from "@reading-studio/contracts"
import { z } from "zod"
import type { CollectionObservation, ManagedDiagnostic } from "./full-book-managed-diagnostic.ts"
import { METHOD_VOCABULARY_VERSION } from "./pinned-codex-notification-methods.ts"
import {
  type FailureSite,
  parseFields,
  safeItem,
  safeMethod,
  unknownMethodSize,
} from "./protocol-observation.ts"
import { safeServerError } from "./protocol-server-error.ts"
import type { SubscriptionToolRpc } from "./subscription-tool-rpc.ts"

const CorrelatableTurnId = z.string().min(1)

export class ManagedEventFault extends Error {
  constructor(
    readonly site: FailureSite,
    readonly fields: ReturnType<typeof parseFields> = [],
  ) {
    super(site)
  }
}
export class ManagedTurnEvents {
  turnId: string | undefined
  terminal: Readonly<{ id: string; status: string }> | undefined
  final: string | undefined
  finalTurn: string | undefined
  bytes = 0
  usage: z.infer<typeof Usage> = { kind: "unknown" }
  diagnostic:
    | Extract<
        z.infer<typeof ManagedDiagnostic>,
        { category: "server-error" | "rpc-rejection" | "invalid-response" }
      >
    | undefined
  private preAckEvents = 0
  private eventTurn: string | undefined
  private method: ReturnType<typeof safeMethod> = "other"
  private unknownSize: ReturnType<typeof unknownMethodSize> | undefined
  private item: ReturnType<typeof safeItem> = "other"
  private phase: z.infer<typeof CollectionObservation>["phase"] = "absent"
  private errorCode: ReturnType<typeof safeServerError>["code"] | undefined
  private ackStatus: z.infer<typeof CollectionObservation>["ackStatus"] = "absent"
  constructor(
    private readonly threadId: string,
    private readonly collectorBytes: number,
  ) {}
  observation(
    rpc: Pick<SubscriptionToolRpc, "observation">,
    fields: ReturnType<typeof parseFields> = [],
  ): z.infer<typeof CollectionObservation> {
    const status = z
      .enum(["completed", "failed", "interrupted", "inProgress"])
      .safeParse(this.terminal?.status)
    return {
      ack: this.turnId ? "received" : "pending",
      ackStatus: this.ackStatus,
      preAckEvents: this.preAckEvents,
      method: this.method,
      methodVocabulary: METHOD_VOCABULARY_VERSION,
      ...(this.unknownSize ? { unknownMethodSize: this.unknownSize } : {}),
      item: this.item,
      phase: this.phase,
      turnSeen: this.eventTurn !== undefined,
      terminalSeen: this.terminal !== undefined,
      finalSeen: this.final !== undefined,
      fields,
      transport: rpc.observation(),
      ...(this.terminal ? { terminalStatus: status.success ? status.data : "other" } : {}),
      ...(this.errorCode ? { errorCode: this.errorCode } : {}),
    }
  }
  private parse<S extends z.ZodType>(schema: S, raw: unknown, site: FailureSite): z.infer<S> {
    const parsed = schema.safeParse(raw)
    if (!parsed.success) throw new ManagedEventFault(site, parseFields(parsed.error))
    return parsed.data
  }
  private correlate(id: string) {
    if (!id) throw new ManagedEventFault("event-turn")
    if ((this.turnId && id !== this.turnId) || (this.eventTurn && id !== this.eventTurn))
      throw new ManagedEventFault("event-turn")
    this.eventTurn = id
  }
  acknowledge(raw: unknown) {
    const result = this.parse(
      z.object({
        turn: z.object({
          id: CorrelatableTurnId,
          status: z.string().optional(),
          error: z.object({ codexErrorInfo: z.unknown().optional() }).nullish(),
        }),
      }),
      raw,
      "ack-shape",
    )
    if (this.eventTurn && this.eventTurn !== result.turn.id)
      throw new ManagedEventFault("event-turn")
    this.turnId = result.turn.id
    const status = z
      .enum(["completed", "failed", "interrupted", "inProgress"])
      .safeParse(result.turn.status)
    this.ackStatus =
      result.turn.status === undefined ? "absent" : status.success ? status.data : "other"
    if (result.turn.error) this.errorCode = safeServerError(result.turn.error.codexErrorInfo).code
    if (
      this.ackStatus !== "absent" &&
      this.ackStatus !== "inProgress" &&
      this.ackStatus !== "completed"
    )
      throw new ManagedEventFault("ack-status")
  }
  complete(clientRequestRejected: boolean) {
    if (!this.turnId || !this.terminal) return false
    if (this.terminal.status !== "completed") throw new ManagedEventFault("terminal-status")
    if (this.final === undefined) throw new ManagedEventFault("terminal-missing-final")
    if (clientRequestRejected) throw new ManagedEventFault("client-request")
    return true
  }
  consume(method: string, raw: unknown) {
    this.method = safeMethod(method)
    this.unknownSize = this.method === "other" ? unknownMethodSize(method) : undefined
    this.item = "other"
    this.phase = "absent"
    if (!this.turnId) this.preAckEvents = Math.min(65535, this.preAckEvents + 1)
    const envelope = this.parse(
      z.object({
        threadId: z.string().optional(),
        turnId: CorrelatableTurnId.optional(),
        item: z.object({ type: z.string(), phase: z.unknown().optional() }).optional(),
      }),
      raw,
      "event-envelope",
    )
    this.item = safeItem(envelope.item?.type)
    if (envelope.item && Object.hasOwn(envelope.item, "phase")) {
      const parsedPhase = z
        .enum(["commentary", "partial_answer", "final_answer"])
        .safeParse(envelope.item.phase)
      this.phase =
        envelope.item.phase === null ? "null" : parsedPhase.success ? parsedPhase.data : "other"
    }
    if (envelope.threadId !== undefined && envelope.threadId !== this.threadId)
      throw new ManagedEventFault("event-thread")
    if (envelope.turnId !== undefined) this.correlate(envelope.turnId)
    switch (method) {
      case "error": {
        const parsed = this.parse(
          z.object({
            threadId: z.string(),
            turnId: z.string(),
            willRetry: z.boolean(),
            error: z.object({ message: z.string(), codexErrorInfo: z.unknown().optional() }),
          }),
          raw,
          "error-shape",
        )
        this.diagnostic = {
          category: "server-error",
          stage: "turn-event",
          ...safeServerError(parsed.error.codexErrorInfo),
        }
        throw new ManagedEventFault("server-error")
      }
      case "item/reasoning/summaryPartAdded": {
        this.parse(
          z.object({
            threadId: z.string(),
            turnId: z.string(),
            itemId: z.string(),
            summaryIndex: z.number().int().nonnegative(),
          }),
          raw,
          "summary-shape",
        )
        return
      }
      case "thread/tokenUsage/updated": {
        const parsed = this.parse(
          z.object({
            tokenUsage: z.object({
              last: z.object({
                inputTokens: z.number().int().nonnegative(),
                outputTokens: z.number().int().nonnegative(),
              }),
            }),
          }),
          raw,
          "usage-shape",
        )
        this.usage = { kind: "known", ...parsed.tokenUsage.last }
        return
      }
      case "item/started":
      case "item/completed": {
        const parsed = this.parse(
          z.object({
            turnId: z.string(),
            item: z.object({
              type: z.string(),
              text: z.string().optional(),
              phase: z.string().nullish(),
              content: z.unknown().optional(),
              id: z.string().optional(),
            }),
          }),
          raw,
          "item-shape",
        )
        switch (parsed.item.type) {
          case "userMessage":
            this.parse(
              z.object({
                id: z.string(),
                content: z.array(z.object({ type: z.literal("text"), text: z.string() })),
              }),
              parsed.item,
              "user-item-shape",
            )
            return
          case "reasoning":
            return
          case "agentMessage":
            break
          default:
            throw new ManagedEventFault("item-kind")
        }
        if (method === "item/started") return
        if (!parsed.item.text) throw new ManagedEventFault("agent-empty")
        this.bytes += Buffer.byteLength(parsed.item.text, "utf8")
        if (this.bytes > this.collectorBytes) throw new ManagedEventFault("collection-limit")
        if (parsed.item.phase === "commentary" || parsed.item.phase === "partial_answer") return
        if (parsed.item.phase !== "final_answer") throw new ManagedEventFault("agent-phase")
        if (this.final !== undefined) throw new ManagedEventFault("agent-duplicate")
        this.final = parsed.item.text
        this.finalTurn = parsed.turnId
        return
      }
      case "turn/completed": {
        const parsed = this.parse(
          z.object({
            turn: z.object({
              id: CorrelatableTurnId,
              status: z.string(),
              error: z.object({ codexErrorInfo: z.unknown().optional() }).nullish(),
            }),
          }),
          raw,
          "terminal-shape",
        )
        this.correlate(parsed.turn.id)
        this.terminal = parsed.turn
        if (parsed.turn.error)
          this.errorCode = safeServerError(parsed.turn.error.codexErrorInfo).code
        if (parsed.turn.status !== "completed") throw new ManagedEventFault("terminal-status")
        return
      }
      case "turn/started": {
        const parsed = this.parse(
          z.object({ turn: z.object({ id: CorrelatableTurnId }) }),
          raw,
          "terminal-shape",
        )
        this.correlate(parsed.turn.id)
        return
      }
      case "item/agentMessage/delta":
      case "item/reasoning/summaryTextDelta":
      case "item/reasoning/textDelta":
        this.parse(
          z.object({
            threadId: z.string(),
            turnId: z.string(),
            itemId: z.string(),
            delta: z.string(),
          }),
          raw,
          "item-shape",
        )
        return
      case "thread/started": {
        const parsed = this.parse(
          z.object({ thread: z.object({ id: z.string() }) }),
          raw,
          "event-envelope",
        )
        if (parsed.thread.id !== this.threadId) throw new ManagedEventFault("event-thread")
        return
      }
      case "thread/status/changed":
        this.parse(z.object({ threadId: z.string() }), raw, "event-envelope")
        return
      case "thread/queue/changed":
        this.parse(
          z.strictObject({ threadId: z.string(), turnId: z.string().min(1).optional() }),
          raw,
          "event-envelope",
        )
        return
      default:
        throw new ManagedEventFault("event-method")
    }
  }
}
