import { LocalSubscriptionSession } from "@reading-studio/contracts"
import type { LocalToolSession, Storage } from "@reading-studio/storage"
import {
  registerSyntheticSubscriptionTool,
  SubscriptionToolRpc,
} from "@reading-studio/storage/test-support"
import { vi } from "vitest"

export function attachManagedSession(
  storage: Storage,
  context: { readonly home: string; readonly metadata: LocalSubscriptionSession },
) {
  const binary = process.env["STUDIO_SUBSCRIPTION_CODEX_BINARY"]
  if (!binary) throw new TypeError("Missing synthetic executable")
  registerSyntheticSubscriptionTool(binary)
  const status = vi.spyOn(storage.subscriptionLogin, "status").mockReturnValue(context.metadata)
  const canDispatch = vi.spyOn(storage.subscriptionLogin, "canDispatch").mockReturnValue(true)
  const profileBlocked = vi
    .spyOn(storage.subscriptionLogin, "profileBlocked")
    .mockReturnValue(false)
  const refresh = vi.spyOn(storage.subscriptionLogin, "refresh").mockResolvedValue(context.metadata)
  const connect = vi
    .spyOn(storage.subscriptionLogin, "connect")
    .mockRejectedValue(new TypeError("New login forbidden"))
  const active = new Set<SubscriptionToolRpc>()
  async function close() {
    const opened = [...active]
    for (const rpc of opened) rpc.stop()
    await Promise.all(opened.map((rpc) => rpc.closed))
  }
  const disconnect = vi
    .spyOn(storage.subscriptionLogin, "disconnect")
    .mockImplementation(async (installation) => {
      const connectionRevision = storage.subscriptionConnections.disconnect(
        installation,
        "chatgpt-subscription",
      )
      const next = LocalSubscriptionSession.parse({
        ...context.metadata,
        status: "disconnected",
        generation: null,
        account: null,
        models: [],
        connectionRevision,
      })
      status.mockReturnValue(next)
      refresh.mockResolvedValue(next)
      canDispatch.mockReturnValue(false)
      await close()
      return next
    })
  async function withSession<T>(
    _installation: string,
    operation: (session: LocalToolSession) => Promise<T>,
  ): Promise<T> {
    const rpc = new SubscriptionToolRpc(context.home, "chatgpt-subscription", true)
    active.add(rpc)
    try {
      await rpc.initialize()
      return await operation({ rpc, state: context.metadata })
    } finally {
      rpc.stop()
      await rpc.closed
      active.delete(rpc)
    }
  }
  const session = vi.spyOn(storage.subscriptionLogin, "withSession").mockImplementation(withSession)
  return { status, canDispatch, profileBlocked, refresh, connect, disconnect, session, close }
}
