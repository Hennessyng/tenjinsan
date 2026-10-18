import type { Context, MiddlewareHandler } from "hono"
import { bodyLimit } from "hono/body-limit"
import { z } from "zod"
import { accessCategories, createSecurityRecorder, type SecurityLogger } from "./security-events.ts"

export type { SecurityEvent, SecurityLogger } from "./security-events.ts"

const resourceIdSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/)
const resourceKinds = ["books", "studies", "jobs", "artifacts"] as const

export type PrivateResourceKind = (typeof resourceKinds)[number]

export type PrivateResource = {
  readonly id: string
  readonly kind: PrivateResourceKind
}

export type ResourceAccess = {
  readonly canAccess: (ownerId: string, resource: PrivateResource) => Promise<boolean>
}

export type LoginRateLimit = {
  readonly attempts: number
  readonly windowMs: number
}

export type SecurityConfig = {
  readonly apiBodyBytes: number
  readonly loginBodyBytes: number
  readonly loginRateLimit: LoginRateLimit
  readonly logger?: SecurityLogger
  readonly resourceAccess?: ResourceAccess
  readonly trustedOrigins: readonly string[]
  readonly trustProxy: boolean
  readonly uploadBodyBytes: number
}

export type AppVariables = {
  readonly ownerId: string
  readonly requestId: string
}

export type AppEnvironment = { Variables: AppVariables }

type AppContext = Context<AppEnvironment>

function normalizeHost(host: string): string | null {
  if (host.includes(",") || host.includes("/") || host.includes("\\")) return null
  try {
    return new URL(`http://${host}`).host
  } catch {
    return null
  }
}

function resourceKind(value: string): PrivateResourceKind | null {
  return resourceKinds.find((kind) => kind === value) ?? null
}

function requestedResource(pathname: string): PrivateResource | "invalid" | null {
  const [, api, collection, encodedId] = pathname.split("/")
  if (api !== "api" || collection === undefined || encodedId === undefined) return null
  const kind = resourceKind(collection)
  if (kind === null) return null
  let decodedId: string
  try {
    decodedId = decodeURIComponent(encodedId)
  } catch {
    return "invalid"
  }
  const id = resourceIdSchema.safeParse(decodedId)
  return id.success ? { id: id.data, kind } : "invalid"
}

function isMutation(method: string): boolean {
  return method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE"
}

function acceptsContentType(pathname: string, contentType: string): boolean {
  const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase()
  if (
    /^\/sources\/[^/]+\/setup(?:\/[^/]+)?$/.test(pathname) ||
    /^\/evidence\/[^/]+\/[^/]+$/.test(pathname) ||
    /^\/(interviews|briefs|outlines|revisions)\/[^/]+$/.test(pathname) ||
    /^\/publications\/[^/]+(?:\/outputs\/[^/]+)?$/.test(pathname)
  ) {
    return mediaType === "application/x-www-form-urlencoded"
  }
  if (pathname.endsWith("/upload")) {
    return (
      mediaType !== undefined &&
      [
        "application/epub+zip",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "text/plain",
        "application/pdf",
        "multipart/form-data",
      ].includes(mediaType)
    )
  }
  return mediaType === "application/json"
}

class FailedLoginLimiter {
  private failedAttempts = 0
  private windowStartedAt = 0

  constructor(
    private readonly config: LoginRateLimit,
    private readonly now: () => number = Date.now,
  ) {}

  isBlocked(): boolean {
    this.resetExpiredWindow()
    return this.failedAttempts >= this.config.attempts
  }

  record(status: number): void {
    this.resetExpiredWindow()
    if (status >= 200 && status < 400) {
      this.failedAttempts = 0
      this.windowStartedAt = 0
    } else if (status === 401) {
      if (this.failedAttempts === 0) this.windowStartedAt = this.now()
      this.failedAttempts += 1
    }
  }

  private resetExpiredWindow(): void {
    if (this.windowStartedAt !== 0 && this.now() - this.windowStartedAt >= this.config.windowMs) {
      this.failedAttempts = 0
      this.windowStartedAt = 0
    }
  }
}

export function createAccessMiddleware(config: SecurityConfig) {
  const trustedOrigins = new Set(config.trustedOrigins.map((origin) => new URL(origin).origin))
  const trustedHosts = new Set([...trustedOrigins].map((origin) => new URL(origin).host))
  const record = createSecurityRecorder(config.logger)
  const loginLimiter = new FailedLoginLimiter(config.loginRateLimit)

  function reject(
    context: AppContext,
    event: keyof typeof accessCategories,
    status: number,
  ): Response {
    record(context, {
      event,
      category: accessCategories[event],
      level: "warn",
      status,
    })
    return new Response(status === 401 ? "Unauthorized" : "Request rejected", {
      status,
      headers: { "X-Request-ID": context.get("requestId"), "X-Trace-ID": context.get("requestId") },
    })
  }

  const requestBoundary: MiddlewareHandler<AppEnvironment> = async (context, next) => {
    context.set("requestId", crypto.randomUUID())
    context.header("X-Request-ID", context.get("requestId"))
    context.header("X-Trace-ID", context.get("requestId"))
    const requestUrl = new URL(context.req.url)
    const forwardedHost = context.req.header("x-forwarded-host")
    const candidateHost =
      config.trustProxy && forwardedHost !== undefined
        ? forwardedHost
        : (context.req.header("host") ?? requestUrl.host)
    const host = normalizeHost(candidateHost)
    if (host === null || !trustedHosts.has(host)) return reject(context, "access.host", 421)
    const origin = context.req.header("origin")
    if (origin !== undefined && !trustedOrigins.has(origin)) {
      return reject(context, "access.origin", 403)
    }
    await next()
    context.header("X-Request-ID", context.get("requestId"))
    context.header("X-Trace-ID", context.get("requestId"))
    return context.res
  }

  const loginRateLimit: MiddlewareHandler<AppEnvironment> = async (context, next) => {
    if (loginLimiter.isBlocked()) return reject(context, "access.rate_limit", 429)
    await next()
    loginLimiter.record(context.res.status)
    return context.res
  }

  const libraryScope = (
    ownerId: string | undefined,
    streamingUpload = false,
  ): MiddlewareHandler<AppEnvironment> => {
    return async (context, next) => {
      if (ownerId === undefined) return context.text("Library ownership is unavailable", 503)
      const pathname = new URL(context.req.url).pathname
      if (isMutation(context.req.method) && context.req.header("origin") === undefined) {
        return reject(context, "access.origin", 403)
      }
      if (
        (context.req.method === "POST" ||
          context.req.method === "PUT" ||
          context.req.method === "PATCH") &&
        !acceptsContentType(pathname, context.req.header("content-type") ?? "")
      ) {
        return reject(context, "access.content_type", 415)
      }
      const resource = requestedResource(pathname)
      if (resource === "invalid") return reject(context, "access.resource", 400)
      if (resource !== null && !(await config.resourceAccess?.canAccess(ownerId, resource))) {
        return reject(context, "access.resource", 404)
      }
      context.set("ownerId", ownerId)
      // Intake enforces its own streaming byte limit; bodyLimit buffers chunked requests.
      if (streamingUpload && pathname === "/api/imports/upload") return next()
      const maxSize = pathname.endsWith("/upload") ? config.uploadBodyBytes : config.apiBodyBytes
      return bodyLimit({
        maxSize,
        onError: (limitedContext) => reject(limitedContext, "access.body_limit", 413),
      })(context, next)
    }
  }

  const loginBodyLimit: MiddlewareHandler<AppEnvironment> = (context, next) =>
    bodyLimit({
      maxSize: config.loginBodyBytes,
      onError: (limitedContext) => reject(limitedContext, "access.body_limit", 413),
    })(context, next)

  return { loginBodyLimit, loginRateLimit, requestBoundary, libraryScope, record } as const
}
