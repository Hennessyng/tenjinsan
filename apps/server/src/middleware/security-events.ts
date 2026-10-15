import type { Context } from "hono"
import type { AppEnvironment } from "./access.ts"
import { createDefaultSecuritySink } from "./security-sink.ts"

export const accessCategories = {
  "access.body_limit": "body-limit",
  "access.content_type": "content-type",
  "access.host": "host",
  "access.origin": "origin",
  "access.rate_limit": "rate-limit",
  "access.resource": "resource",
  "access.session": "session",
} as const

export type LoginCategory =
  | "validation"
  | "invalid-credentials"
  | "origin"
  | "cross-site"
  | "session"
  | "rate-limit"
  | "internal"
  | "unknown"
  | "success"

export type SecurityDecision = {
  readonly event:
    | keyof typeof accessCategories
    | "auth.login.validation"
    | "auth.login.rejected"
    | "auth.login.exception"
    | "auth.login.success"
  readonly category: LoginCategory | (typeof accessCategories)[keyof typeof accessCategories]
  readonly level: "warn" | "info" | "error"
  readonly status: number | null
  readonly upstream_status?: number
}

export type SecurityEvent = SecurityDecision & {
  readonly method: string
  readonly requestId: string
  readonly trace_id: string
  readonly route: string
}

export type SecurityLogger = (event: SecurityEvent) => void
export type RecordSecurityDecision = (
  context: Context<AppEnvironment>,
  decision: SecurityDecision,
) => void

const routes = new Set([
  "login",
  "logout",
  "sources",
  "interviews",
  "briefs",
  "outlines",
  "evidence",
  "publications",
  "revisions",
  "publication-artifacts",
  "health",
])
const apiRoutes = new Set(["auth", "jobs", "books", "studies", "artifacts", "imports", "backups"])
const methods = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])

function routeName(pathname: string): string {
  const [first, second] = pathname.split("/").filter((part) => part !== "")
  if (first === undefined) return "/"
  if (first === "api")
    return second !== undefined && apiRoutes.has(second) ? `/api/${second}` : "/api"
  return routes.has(first) ? `/${first}` : "/other"
}

export function createSecurityRecorder(logger?: SecurityLogger): RecordSecurityDecision {
  const sink = logger ?? createDefaultSecuritySink()
  return (context, decision) => {
    const requestId = context.get("requestId")
    // Logging is a best-effort boundary; a failed sink must not change security responses.
    // no-excuse-ok: catch
    try {
      sink({
        ...decision,
        method: methods.has(context.req.method) ? context.req.method : "OTHER",
        requestId,
        trace_id: requestId,
        route: routeName(context.req.path),
      })
    } catch {
      return
    }
  }
}
