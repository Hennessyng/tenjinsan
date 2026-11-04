import { once } from "node:events"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { getRequestListener } from "@hono/node-server"
import type { ArchiveLimits } from "@reading-studio/ingestion/archive"
import type { VerifiedRouteCapacity } from "@reading-studio/providers"
import { openAuthStorage, openStorage } from "@reading-studio/storage"
import { createApp } from "../app.ts"
import { productionIntake } from "../intake.ts"
import { loadStudioAssets } from "../studio-assets.ts"
import { studySetupSend } from "../study-setup-send.ts"
import type { UploadWithHook } from "../upload.ts"
import { managedServerSession } from "./managed-server-session.ts"

export async function uploadHarness(options?: {
  readonly studioAssets?: boolean
  readonly providerAvailable?: boolean
  readonly onAccepted?: UploadWithHook["onAccepted"]
  readonly limits?: ArchiveLimits
  readonly queueAnalysis?: boolean
  readonly localSubscriptions?: boolean
  readonly managedChatGPT?: boolean
  readonly managedCapacity?: boolean
  readonly bookMapCapacity?: VerifiedRouteCapacity
}) {
  const directory = await mkdtemp(join(tmpdir(), "upload-http-"))
  const root = join(directory, "private")
  await mkdir(root, { mode: 0o700 })
  const server = createServer()
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  if (address === null || typeof address === "string") throw new TypeError("Missing address")
  const origin = `http://127.0.0.1:${address.port}`
  const storage = openAuthStorage(join(directory, "auth.sqlite"))
  const sourceStorage = openStorage({
    databasePath: join(directory, "auth.sqlite"),
    privateDataRoot: root,
  })
  const managed = options?.managedChatGPT
    ? managedServerSession(sourceStorage, storage.ensureLibraryOwner(), origin)
    : undefined
  const capacity =
    options?.bookMapCapacity ?? (options?.managedCapacity ? managed?.capacity : undefined)
  const app = createApp({
    ...(capacity ? { bookMapCapacity: capacity } : {}),
    ...(options?.queueAnalysis
      ? {
          onSetupSend: studySetupSend(sourceStorage, true, {
            localSubscriptions: options.localSubscriptions ?? false,
            ...(capacity ? { capacity } : {}),
          }),
        }
      : {}),
    ...(options?.localSubscriptions ? { serverHost: "127.0.0.1" } : {}),
    ...(options?.studioAssets
      ? { studioAssets: loadStudioAssets(resolve(import.meta.dirname, "../../../studio/dist")) }
      : {}),
    reviewStorage: sourceStorage,
    interviews: sourceStorage.interviews,
    providerAvailable: () => options?.providerAvailable ?? false,
    sources: sourceStorage.sources,
    libraryOwnerId: storage.ensureLibraryOwner(),
    upload: {
      root,
      limits: options?.limits ?? {
        compressedBytes: 8192,
        decompressedBytes: 4096,
        entries: 10,
        entryBytes: 2048,
      },
      onAccepted: options?.onAccepted ?? productionIntake(sourceStorage, root),
    },
    security: {
      apiBodyBytes: 1024,
      loginBodyBytes: 4096,
      loginRateLimit: { attempts: 10, windowMs: 60000 },
      trustedOrigins: [origin],
      trustProxy: false,
      uploadBodyBytes: options?.limits?.compressedBytes ?? 8192,
      logger: () => undefined,
    },
  })
  server.on("request", getRequestListener(app.fetch))
  return {
    root,
    sourceStorage,
    managed,
    directory,
    origin,
    headers: { origin, "content-type": "application/epub+zip" },
    close: async () => {
      const closed = new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
      server.closeAllConnections()
      await closed
      storage.close()
      sourceStorage.close()
      await rm(directory, { recursive: true, force: true })
      managed?.assertOffline()
    },
  }
}
