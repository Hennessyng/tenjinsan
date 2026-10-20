import { setTimeout } from "node:timers/promises"
import type { LocalSubscriptionSession } from "@reading-studio/contracts"
import { z } from "zod"
import { SubscriptionLoginError } from "./subscription-session-store.ts"
import type { SubscriptionToolRpc } from "./subscription-tool-rpc.ts"

const Meta = z.object({
  _meta: z.object({ auth_mode: z.literal("Oidc"), subscription_tier: z.string().nullish() }),
})
const Info = z.object({
  methodId: z.enum(["grok.com", "cached_token"]),
  email: z.string().nullable(),
  principalType: z.string().nullable(),
  principalId: z.string().nullable(),
  teamId: z.string().nullable(),
})
const Models = z.object({
  error: z.null().optional(),
  result: z.object({
    availableModels: z.array(z.object({ modelId: z.string().min(1), name: z.string().min(1) })),
  }),
})
const Url = z.object({
  auth_url: z.url().nullable(),
  mode: z.string().nullable(),
  external_provider: z.boolean(),
})

export async function beginGrokLogin(rpc: SubscriptionToolRpc, state: LocalSubscriptionSession) {
  if (!rpc.authMethods.has("grok.com")) throw new SubscriptionLoginError("protocol-error")
  const completed = rpc
    .request(
      "authenticate",
      {
        methodId: "grok.com",
        _meta: {
          use_oauth: true,
          force_interactive: true,
          request_seq: state.connectionRevision,
        },
      },
      300000,
    )
    .then(
      (value) => Meta.safeParse(value).success,
      (error: unknown) => {
        if (error instanceof SubscriptionLoginError) return false
        throw error
      },
    )
  for (let index = 0; index < 60; index++) {
    const url = Url.parse(await rpc.request("_x.ai/auth/get_url", {}))
    if (url.auth_url) {
      const parsed = new URL(url.auth_url)
      if (
        url.mode !== "loopback" ||
        url.external_provider ||
        parsed.protocol !== "https:" ||
        parsed.hostname !== "auth.x.ai"
      )
        throw new SubscriptionLoginError("protocol-error")
      return { authUrl: url.auth_url, completed }
    }
    await setTimeout(50)
  }
  throw new SubscriptionLoginError("login-failed")
}

export async function discoverGrokAccount(
  rpc: SubscriptionToolRpc,
  state: LocalSubscriptionSession,
): Promise<LocalSubscriptionSession> {
  // Only official cached OAuth is permitted; an unavailable session never falls through to API-key auth.
  const auth = Meta.parse(await rpc.request("authenticate", { methodId: "cached_token" }))
  const info = Info.parse(await rpc.request("_x.ai/auth/info", {}))
  const models = Models.parse(await rpc.request("_x.ai/models/list", {}))
  return {
    ...state,
    status: "connected",
    authUrl: null,
    expiresAt: null,
    catalog: "checked",
    account: {
      email: info.email,
      accountId: info.principalType === "user" ? info.principalId : null,
      workspaceId: info.teamId,
      planType: auth._meta.subscription_tier ?? "unknown",
    },
    models: models.result.availableModels.map((model) => ({
      model: model.modelId,
      label: model.name,
    })),
  }
}
