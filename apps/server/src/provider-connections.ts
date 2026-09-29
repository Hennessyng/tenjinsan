import { randomUUID } from "node:crypto"
import { modelChoices, ProviderAdapter } from "@reading-studio/providers"
import type { Storage } from "@reading-studio/storage"
import type { Hono } from "hono"
import type { AppEnvironment } from "./middleware/access.ts"

export function ownerConnection(
  storage: Storage,
  ownerId: string,
): ReturnType<Storage["providerConnections"]["codex"]> {
  const installationId =
    storage.sources.getInstallation(ownerId) ??
    storage.sources.createInstallation({ id: randomUUID(), ownerId })
  return storage.providerConnections.codex(ownerId, installationId)
}
export async function offeredModels(storage: Storage | undefined, ownerId: string) {
  const openrouter = await ProviderAdapter.openRouterModels().catch(() => [])
  const codex = storage
    ? await ownerConnection(storage, ownerId)
        .models()
        .catch(() => [])
    : []
  return [...modelChoices, ...openrouter, ...codex]
}
export function configureProviderConnections(app: Hono<AppEnvironment>, storage: Storage) {
  app.get("/api/provider-connections/codex", async (context) => {
    context.header("Cache-Control", "private, no-store")
    const models = await ownerConnection(storage, context.get("ownerId"))
      .models()
      .catch(() => [])
    return context.json({
      available: models.length > 0,
      status: models.length ? "connected" : "unavailable",
      f4: "BLOCKED",
    })
  })
  app.post("/api/provider-connections/codex/:action", async (context) => {
    context.header("Cache-Control", "private, no-store")
    if (!context.req.header("origin")) return context.json({ error: "Forbidden" }, 403)
    const connection = ownerConnection(storage, context.get("ownerId"))
    switch (context.req.param("action")) {
      case "connect":
        try {
          return context.json(await connection.connect())
        } catch (error) {
          if (!(error instanceof Error)) throw error
          return context.json({ error: "Official Codex route unavailable" }, 503)
        }
      case "disconnect":
        await connection.disconnect()
        return context.json({ available: false, status: "unavailable", f4: "BLOCKED" })
      default:
        return context.json({ error: "Unknown action" }, 404)
    }
  })
}
