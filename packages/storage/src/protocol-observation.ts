import { z } from "zod"
import { PINNED_CODEX_NOTIFICATION_METHODS } from "./pinned-codex-notification-methods.ts"
export const FailureSite = z.enum([
  "line-size",
  "json-invalid",
  "envelope-invalid",
  "response-id",
  "response-empty",
  "response-error-shape",
  "notice-overflow",
  "server-request",
  "request-timeout",
  "frame-invalid",
  "write-failed",
  "process-error",
  "stdin-error",
  "process-closed",
  "stopped",
  "raw-bound",
  "raw-overflow",
  "rpc-rejection",
  "initialize-auth",
  "event-envelope",
  "event-thread",
  "event-turn",
  "event-method",
  "error-shape",
  "server-error",
  "summary-shape",
  "usage-shape",
  "item-shape",
  "item-kind",
  "user-item-shape",
  "agent-empty",
  "agent-phase",
  "agent-duplicate",
  "terminal-shape",
  "terminal-status",
  "terminal-missing-final",
  "client-request",
  "ack-shape",
  "ack-status",
  "collection-limit",
  "collection-timeout",
  "cancelled",
  "runner-postflight",
  "runner-setup",
  "runner-authority",
])
export type FailureSite = z.infer<typeof FailureSite>
export const SafeMethod = z.enum([
  ...PINNED_CODEX_NOTIFICATION_METHODS,
  "item/commandExecution/requestApproval",
  "legacy-codex-event",
  "other",
])
export const UnknownMethodSize = z.enum(["empty", "1-64", "65-256", "over-256"])
export function unknownMethodSize(method: string): z.infer<typeof UnknownMethodSize> {
  const bytes = Buffer.byteLength(method, "utf8")
  return bytes === 0 ? "empty" : bytes <= 64 ? "1-64" : bytes <= 256 ? "65-256" : "over-256"
}
export const SafeItem = z.enum([
  "userMessage",
  "agentMessage",
  "reasoning",
  "commandExecution",
  "fileChange",
  "mcpToolCall",
  "dynamicToolCall",
  "hookPrompt",
  "other",
])
export const SafeSignal = z.enum([
  "SIGTERM",
  "SIGINT",
  "SIGKILL",
  "SIGPIPE",
  "SIGSEGV",
  "SIGABRT",
  "other",
])
export const TransportObservation = z.strictObject({
  closed: z.boolean(),
  stopped: z.boolean(),
  stdoutClosed: z.boolean(),
  exitCode: z.number().int().nullable(),
  signal: SafeSignal.nullable(),
  nativeExitObserved: z.boolean(),
  nativeExitCode: z.number().int().nullable(),
  nativeSignal: SafeSignal.nullable(),
})
export const ParseField = z.enum([
  "id",
  "method",
  "params",
  "result",
  "error",
  "threadId",
  "turnId",
  "turn",
  "item",
  "type",
  "text",
  "phase",
  "content",
  "status",
  "tokenUsage",
  "last",
  "inputTokens",
  "outputTokens",
  "itemId",
  "summaryIndex",
  "willRetry",
  "approvalPolicy",
  "activePermissionProfile",
  "sandbox",
  "networkAccess",
  "runtimeWorkspaceRoots",
  "instructionSources",
  "model",
  "modelProvider",
  "cwd",
  "turns",
  "items",
  "codexErrorInfo",
  "additionalDetails",
  "code",
  "jsonrpc",
  "message",
  "index",
  "other",
])
export function safeMethod(method: string): z.infer<typeof SafeMethod> {
  const parsed = SafeMethod.safeParse(method)
  return parsed.success
    ? parsed.data
    : method === "codex/event" || method.startsWith("codex/event/")
      ? "legacy-codex-event"
      : "other"
}
export function safeItem(raw: unknown): z.infer<typeof SafeItem> {
  const parsed = SafeItem.safeParse(raw)
  return parsed.success ? parsed.data : "other"
}
export function parseFields(error: z.ZodError): z.infer<typeof ParseField>[] {
  return error.issues
    .flatMap((issue) => issue.path)
    .slice(0, 8)
    .map((part) => {
      const parsed = ParseField.safeParse(part)
      return parsed.success ? parsed.data : typeof part === "number" ? "index" : "other"
    })
}
