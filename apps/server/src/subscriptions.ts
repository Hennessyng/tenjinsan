import { randomUUID } from "node:crypto"
import { SubscriptionProvider, SubscriptionSnapshot } from "@reading-studio/contracts"
import { type Storage, SubscriptionLoginError } from "@reading-studio/storage"
import type { Hono } from "hono"
import { z } from "zod"
import type { AppEnvironment, SecurityConfig } from "./middleware/access.ts"

const loopback = new Set(["127.0.0.1", "::1", "[::1]", "localhost"])
export function hasForwardedHeaders(headers: Headers): boolean {
  return ["forwarded", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto"].some((header) =>
    headers.has(header),
  )
}
export function localSubscriptionAccess(
  host: string | undefined,
  security: Pick<SecurityConfig, "trustedOrigins" | "trustProxy">,
): boolean {
  return (
    host !== undefined &&
    loopback.has(host) &&
    !security.trustProxy &&
    security.trustedOrigins.length > 0 &&
    security.trustedOrigins.every((origin) => loopback.has(new URL(origin).hostname))
  )
}
const routes = {
  "chatgpt-subscription": "codex-app-server",
  "claude-subscription": "claude-code-unmodified",
  "grok-subscription": "grok-build",
} as const

export function configureSubscriptions(
  app: Hono<AppEnvironment>,
  options: {
    readonly storage: Storage
    readonly local: boolean
  },
) {
  const { storage, local } = options
  const logins = {
    "chatgpt-subscription": storage.subscriptionLogin,
    "grok-subscription": storage.grokSubscriptionLogin,
  }
  function installation(ownerId: string): string {
    return (
      storage.sources.getInstallation(ownerId) ??
      storage.sources.createInstallation({ id: randomUUID(), ownerId })
    )
  }
  function snapshot(ownerId: string): SubscriptionSnapshot {
    const installationId = local ? installation(ownerId) : null
    return SubscriptionSnapshot.parse({
      deployment: local ? "local" : "hosted",
      connections: SubscriptionProvider.options.map((provider) => {
        const revision = installationId
          ? storage.subscriptionConnections.revision(installationId, provider)
          : 0
        const session =
          local && installationId && provider !== "claude-subscription"
            ? logins[provider].status(installationId)
            : null
        const dispatchReady =
          local &&
          installationId !== null &&
          provider !== "claude-subscription" &&
          logins[provider].canDispatch(installationId)
        const profileBlocked =
          local &&
          installationId !== null &&
          provider !== "claude-subscription" &&
          logins[provider].profileBlocked(installationId)
        return {
          provider,
          route: routes[provider],
          status: !local
            ? "local-only"
            : (session?.status ?? (revision > 0 ? "disconnected" : "prerequisites-missing")),
          connectionRevision: revision,
          canConnect:
            local &&
            !profileBlocked &&
            provider !== "claude-subscription" &&
            session?.status !== "pending" &&
            session?.status !== "connected",
          canDispatch: dispatchReady,
          billingRoute: provider === "claude-subscription" ? null : "subscription-provider-managed",
          authUrl: session?.authUrl ?? null,
          catalog: session?.catalog ?? "not-checked",
          models: session?.models ?? [],
          account: session?.account ?? null,
          blockers:
            provider === "claude-subscription"
              ? [
                  "commercial-permission",
                  "account-entitlement",
                  "allowance-only",
                  "tool-isolation",
                  "live-proof",
                ]
              : profileBlocked
                ? ["custom-configuration"]
                : [],
        }
      }),
    })
  }
  app.use("/api/subscription-connections*", async (context, next) => {
    context.header("Cache-Control", "private, no-store")
    if (local && hasForwardedHeaders(context.req.raw.headers))
      return context.json({ error: "local-only", transmission: "not-sent" }, 403)
    return next()
  })
  app.get("/api/subscription-connections", (context) =>
    context.json(snapshot(context.get("ownerId"))),
  )
  app.post("/api/subscription-connections/:provider/:action", async (context) => {
    if (!local) return context.json({ error: "local-only", transmission: "not-sent" }, 403)
    if (!context.req.header("origin")) return context.json({ error: "Forbidden" }, 403)
    const provider = SubscriptionProvider.safeParse(context.req.param("provider"))
    if (!provider.success) return context.json({ error: "Unknown subscription provider" }, 404)
    let body: unknown
    try {
      body = await context.req.json()
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error
      return context.json({ error: "invalid-connection-request", transmission: "not-sent" }, 400)
    }
    if (!z.strictObject({}).safeParse(body).success)
      return context.json({ error: "invalid-connection-request", transmission: "not-sent" }, 400)
    if (provider.data !== "claude-subscription") {
      try {
        const id = installation(context.get("ownerId"))
        const login = logins[provider.data]
        switch (context.req.param("action")) {
          case "connect":
          case "reconnect":
            await login.connect(id)
            break
          case "refresh":
            await login.refresh(id)
            break
          case "disconnect":
            await login.disconnect(id)
            break
          default:
            return context.json({ error: "Unknown action" }, 404)
        }
        return context.json(snapshot(context.get("ownerId")))
      } catch (error) {
        if (!(error instanceof SubscriptionLoginError)) throw error
        return context.json(
          { error: error.code, transmission: "not-sent" },
          error.code === "connection-busy" ? 409 : 503,
        )
      }
    }
    switch (context.req.param("action")) {
      case "refresh":
        return context.json(snapshot(context.get("ownerId")))
      case "disconnect":
        storage.subscriptionConnections.disconnect(
          installation(context.get("ownerId")),
          provider.data,
        )
        return context.json({
          ...snapshot(context.get("ownerId")),
          revocation: "not-attempted-no-authorized-route",
        })
      case "connect":
      case "reconnect":
        // Never accept eligibility assertions or credentials from the caller.
        return context.json({ error: "prerequisites-missing", transmission: "not-sent" }, 409)
      default:
        return context.json({ error: "Unknown action" }, 404)
    }
  })
}
