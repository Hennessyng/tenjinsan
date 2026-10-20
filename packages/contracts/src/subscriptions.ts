import { z } from "zod"
import { InstallationId, Text } from "./primitives.ts"

export const SubscriptionProvider = z.enum([
  "chatgpt-subscription",
  "claude-subscription",
  "grok-subscription",
])
export type SubscriptionProvider = z.infer<typeof SubscriptionProvider>
export const LocalSubscriptionProvider = z.enum(["chatgpt-subscription", "grok-subscription"])
export type LocalSubscriptionProvider = z.infer<typeof LocalSubscriptionProvider>
export function isSubscriptionProvider(provider: string): provider is SubscriptionProvider {
  return SubscriptionProvider.safeParse(provider).success
}
const ObservedAccount = z
  .strictObject({
    email: z.string().nullable(),
    accountId: Text.nullable().optional(),
    planType: Text,
    workspaceId: Text.nullable(),
  })
  .readonly()

// Non-secret identity only. Tokens and refresh metadata never belong in consent.
export const SubscriptionDestination = z
  .strictObject({
    provider: SubscriptionProvider,
    accountId: Text,
    workspaceId: Text.nullable(),
    installationId: InstallationId,
    connectionRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    billingRoute: z.enum(["subscription-allowance", "subscription-provider-managed"]),
    executionPolicy: z.literal("tool-managed-v1").optional(),
    identityBinding: z.literal("local-generation-and-observations").optional(),
    observedAccount: ObservedAccount.optional(),
  })
  .readonly()
export type SubscriptionDestination = z.infer<typeof SubscriptionDestination>
export function sameSubscriptionDestination(
  left: SubscriptionDestination | undefined,
  right: SubscriptionDestination | undefined,
): boolean {
  if (!left || !right) return left === right
  return (
    left.provider === right.provider &&
    left.accountId === right.accountId &&
    left.workspaceId === right.workspaceId &&
    left.installationId === right.installationId &&
    left.connectionRevision === right.connectionRevision &&
    left.billingRoute === right.billingRoute &&
    left.executionPolicy === right.executionPolicy &&
    left.identityBinding === right.identityBinding &&
    JSON.stringify(left.observedAccount) === JSON.stringify(right.observedAccount)
  )
}

export const SubscriptionSnapshot = z
  .strictObject({
    deployment: z.enum(["local", "hosted"]),
    revocation: z.literal("not-attempted-no-authorized-route").optional(),
    connections: z
      .array(
        z
          .strictObject({
            provider: SubscriptionProvider,
            route: z.enum([
              "sign-in-with-chatgpt",
              "codex-app-server",
              "claude-code-unmodified",
              "grok-build",
            ]),
            status: z.enum([
              "prerequisites-missing",
              "disconnected",
              "local-only",
              "pending",
              "connected",
              "expired",
              "error",
            ]),
            connectionRevision: z.number().int().nonnegative(),
            canConnect: z.boolean(),
            canDispatch: z.boolean().default(false),
            billingRoute: z.literal("subscription-provider-managed").nullable().optional(),
            authUrl: z
              .url()
              .refine((value) => {
                const url = new URL(value)
                return (
                  url.protocol === "https:" &&
                  ["auth.openai.com", "auth.x.ai"].includes(url.hostname)
                )
              })
              .nullable()
              .optional(),
            catalog: z.enum(["not-checked", "checked", "failed"]),
            models: z.array(z.strictObject({ model: Text, label: Text }).readonly()).readonly(),
            account: z
              .strictObject({
                email: z.string().nullable(),
                accountId: Text.nullable().optional(),
                planType: Text,
                workspaceId: Text.nullable(),
              })
              .readonly()
              .nullable(),
            blockers: z
              .array(
                z.enum([
                  "commercial-permission",
                  "account-entitlement",
                  "allowance-only",
                  "tool-isolation",
                  "live-proof",
                  "integration-pending",
                  "call-budget-unverified",
                  "identity-unavailable",
                  "custom-configuration",
                ]),
              )
              .readonly(),
          })
          .readonly(),
      )
      .readonly(),
  })
  .readonly()
export type SubscriptionSnapshot = z.infer<typeof SubscriptionSnapshot>

export const LocalSubscriptionSession = z
  .strictObject({
    status: z.enum(["disconnected", "pending", "connected", "expired", "error"]),
    generation: z.uuid().nullable(),
    connectionRevision: z.number().int().nonnegative(),
    billingRoute: z.literal("subscription-provider-managed"),
    authUrl: z.url().nullable(),
    expiresAt: z.number().nullable(),
    catalog: z.enum(["not-checked", "checked", "failed"]),
    account: z
      .strictObject({
        email: z.string().nullable(),
        accountId: Text.nullable().optional(),
        planType: Text,
        workspaceId: Text.nullable(),
      })
      .readonly()
      .nullable(),
    models: z.array(z.strictObject({ model: Text, label: Text }).readonly()).readonly(),
  })
  .readonly()
export type LocalSubscriptionSession = z.infer<typeof LocalSubscriptionSession>

export function subscriptionDestination(
  provider: LocalSubscriptionProvider,
  installationId: string,
  session: LocalSubscriptionSession,
): SubscriptionDestination | null {
  if (session.status !== "connected" || !session.generation || !session.account) return null
  return SubscriptionDestination.parse({
    provider,
    installationId,
    accountId: session.generation,
    workspaceId: session.account.workspaceId,
    connectionRevision: session.connectionRevision,
    billingRoute: "subscription-provider-managed",
    executionPolicy: "tool-managed-v1",
    identityBinding: "local-generation-and-observations",
    observedAccount: session.account,
  })
}
