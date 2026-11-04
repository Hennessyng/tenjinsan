import { z } from "zod"
import { METHOD_VOCABULARY_VERSION } from "./pinned-codex-notification-methods.ts"
import {
  FailureSite,
  ParseField,
  SafeItem,
  SafeMethod,
  TransportObservation,
  UnknownMethodSize,
} from "./protocol-observation.ts"
import { ServerErrorCode } from "./protocol-server-error.ts"

export const CollectionObservation = z.strictObject({
  ack: z.enum(["pending", "received"]),
  ackStatus: z.enum(["absent", "completed", "failed", "interrupted", "inProgress", "other"]),
  preAckEvents: z.number().int().min(0).max(65535),
  method: SafeMethod,
  methodVocabulary: z.literal(METHOD_VOCABULARY_VERSION).optional(),
  unknownMethodSize: UnknownMethodSize.optional(),
  item: SafeItem,
  fields: z.array(ParseField).max(8),
  phase: z.enum(["absent", "null", "commentary", "partial_answer", "final_answer", "other"]),
  turnSeen: z.boolean(),
  terminalSeen: z.boolean(),
  finalSeen: z.boolean(),
  transport: TransportObservation,
  terminalStatus: z.enum(["completed", "failed", "interrupted", "inProgress", "other"]).optional(),
  errorCode: ServerErrorCode.optional(),
})
const context = { site: FailureSite.optional(), observation: CollectionObservation.optional() }

export const ManagedDiagnostic = z.discriminatedUnion("category", [
  z.strictObject({
    ...context,
    category: z.literal("rpc-rejection"),
    stage: z.enum(["turn-start-response", "setup-response"]),
    code: z.union([
      z.literal(-32700),
      z.literal(-32600),
      z.literal(-32601),
      z.literal(-32602),
      z.literal(-32603),
      z.literal("other"),
    ]),
  }),
  z.strictObject({
    ...context,
    category: z.literal("invalid-response"),
    stage: z.literal("turn-start-response"),
  }),
  z.strictObject({
    ...context,
    category: z.literal("server-error"),
    stage: z.literal("turn-event"),
    code: ServerErrorCode,
    httpStatus: z.number().int().min(0).max(65535).optional(),
  }),
  z.strictObject({
    category: z.literal("collector"),
    stage: z.enum(["turn-event", "turn-start-response", "runner"]),
    site: FailureSite,
    observation: CollectionObservation,
  }),
  z.strictObject({
    category: z.literal("transport"),
    method: SafeMethod.optional(),
    frameCode: z.enum(["invalid-frame", "frame-limit"]).optional(),
    stage: z.literal("rpc"),
    site: FailureSite,
    fields: z.array(ParseField).max(8),
    transport: TransportObservation.optional(),
    observation: CollectionObservation.optional(),
  }),
  z.strictObject({
    category: z.literal("runner"),
    stage: z.literal("runner"),
    site: FailureSite,
    fields: z.array(ParseField).max(8),
  }),
])
