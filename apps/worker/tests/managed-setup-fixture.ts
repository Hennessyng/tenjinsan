import type { LocalSubscriptionSession } from "@reading-studio/contracts"
import type { VerifiedRouteCapacity } from "@reading-studio/providers"
import { createApp } from "@reading-studio/server/app"
import { createProductionApplication } from "@reading-studio/server/production-app"
import type { Storage } from "@reading-studio/storage"
import { z } from "zod"
import type { attachManagedSession } from "./managed-session-fixture.ts"

export type ManagedSetupState = {
  readonly storage: Storage
  readonly session: ReturnType<typeof attachManagedSession>
  readonly metadata: LocalSubscriptionSession
  readonly installationId: string
}
export type ManagedSetupOptions = {
  readonly serverCapacity?: boolean
  readonly queueStages?: boolean
  readonly allowSendRefusal?: boolean
  readonly beforeSend?: (state: ManagedSetupState) => void | Promise<void>
}

export async function managedSetup(
  input: ManagedSetupState & {
    readonly databasePath: string
    readonly privateRoot: string
    readonly normalizationId: string
    readonly capacity: VerifiedRouteCapacity
    readonly options: ManagedSetupOptions
  },
) {
  const origin = "http://127.0.0.1:8787"
  const capacity = input.options.serverCapacity === false ? {} : { capacity: input.capacity }
  const app =
    input.options.queueStages === false
      ? createApp({
          serverHost: "127.0.0.1",
          reviewStorage: input.storage,
          sources: input.storage.sources,
          libraryOwnerId: input.storage.libraryOwnerId(),
          ...(input.options.serverCapacity === false ? {} : { bookMapCapacity: input.capacity }),
          security: {
            trustedOrigins: [origin],
            trustProxy: false,
            apiBodyBytes: 8192,
            loginBodyBytes: 4096,
            loginRateLimit: { attempts: 5, windowMs: 60000 },
            uploadBodyBytes: 8192,
          },
        })
      : createProductionApplication({
          storage: input.storage,
          privateRoot: input.privateRoot,
          ...capacity,
          config: {
            databasePath: input.databasePath,
            host: "127.0.0.1",
            port: 8787,
            trustedOrigins: [origin],
            trustProxy: false,
          },
        })
  const post = (path: string, data: unknown) =>
    app.request(`${origin}${path}`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify(data),
    })
  const drafted = await post(`/api/study-setup/${input.normalizationId}`, {
    provider: "chatgpt-subscription",
    model: "study-model",
  })
  if (drafted.status !== 201) throw new TypeError(`Synthetic draft failed: HTTP ${drafted.status}`)
  const setupId = z.object({ setupId: z.string() }).parse(await drafted.json()).setupId
  await input.options.beforeSend?.(input)
  const sent = await post(`/api/study-setup/${input.normalizationId}/${setupId}`, {
    decision: "send",
  })
  if (
    input.options.serverCapacity !== false &&
    !input.options.allowSendRefusal &&
    sent.status !== 200
  )
    throw new TypeError(`Synthetic Send failed: HTTP ${sent.status}`)
  return {
    setupId,
    sent,
    app: { request: (path: string, init?: RequestInit) => app.request(path, init) },
  }
}
