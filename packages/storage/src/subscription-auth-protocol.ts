import type { LocalSubscriptionSession } from "@reading-studio/contracts"
import { z } from "zod"
import { discoverSubscriptionAccount } from "./subscription-codex-discovery.ts"
import { beginGrokLogin, discoverGrokAccount } from "./subscription-grok-protocol.ts"
import type { SubscriptionToolRpc } from "./subscription-tool-rpc.ts"

const Login = z.object({
  type: z.literal("chatgpt"),
  loginId: z.string().min(1),
  authUrl: z.url().refine((value) => {
    const url = new URL(value)
    return url.protocol === "https:" && url.hostname === "auth.openai.com"
  }),
})
export async function beginSubscriptionLogin(
  rpc: SubscriptionToolRpc,
  state: LocalSubscriptionSession,
) {
  switch (rpc.provider) {
    case "grok-subscription":
      return { ...(await beginGrokLogin(rpc, state)), expiresAt: state.expiresAt }
    case "chatgpt-subscription": {
      const login = Login.parse(await rpc.request("account/login/start", { type: "chatgpt" }))
      return {
        authUrl: login.authUrl,
        completed: rpc.completion(login.loginId),
        expiresAt: Date.now() + 10 * 60000,
      }
    }
    default:
      return assertNever(rpc.provider)
  }
}
export function discoverLocalAccount(rpc: SubscriptionToolRpc, state: LocalSubscriptionSession) {
  switch (rpc.provider) {
    case "grok-subscription":
      return discoverGrokAccount(rpc, state)
    case "chatgpt-subscription":
      return discoverSubscriptionAccount(rpc, state)
    default:
      return assertNever(rpc.provider)
  }
}
function assertNever(value: never): never {
  throw new TypeError(`Unexpected provider: ${value}`)
}
