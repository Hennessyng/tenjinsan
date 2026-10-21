import type { LocalSubscriptionSession } from "@reading-studio/contracts"
import { z } from "zod"
import { SubscriptionLoginError } from "./subscription-session-store.ts"
import type { SubscriptionToolRpc } from "./subscription-tool-rpc.ts"

const Account = z.object({
  account: z.object({
    type: z.literal("chatgpt"),
    email: z.string().nullable(),
    planType: z.string().min(1),
  }),
  workspaceRouting: z.object({ chatgptAccountId: z.string().min(1) }).nullish(),
})
const Models = z.object({
  data: z.array(
    z.object({
      model: z.string().min(1),
      displayName: z.string().min(1),
      hidden: z.boolean().optional(),
    }),
  ),
  nextCursor: z.string().nullable(),
})

export async function discoverSubscriptionAccount(
  rpc: SubscriptionToolRpc,
  state: LocalSubscriptionSession,
): Promise<LocalSubscriptionSession> {
  const { account, workspaceRouting } = Account.parse(
    await rpc.request("account/read", { refreshToken: true }),
  )
  const models: { model: string; label: string }[] = []
  const cursors = new Set<string>()
  let cursor: string | null = null
  do {
    const page = Models.parse(await rpc.request("model/list", { cursor, limit: 100 }))
    models.push(
      ...page.data
        .filter((model) => !model.hidden)
        .map((model) => ({ model: model.model, label: model.displayName })),
    )
    cursor = page.nextCursor
    if (cursor && cursors.has(cursor)) throw new SubscriptionLoginError("protocol-error")
    if (cursor) cursors.add(cursor)
    if (cursors.size > 100) throw new SubscriptionLoginError("protocol-error")
  } while (cursor)
  return {
    ...state,
    status: "connected",
    authUrl: null,
    expiresAt: null,
    catalog: "checked",
    models,
    account: {
      email: account.email,
      accountId: null,
      planType: account.planType,
      workspaceId: workspaceRouting?.chatgptAccountId ?? null,
    },
  }
}
