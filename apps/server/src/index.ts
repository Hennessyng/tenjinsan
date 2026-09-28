import { resolve } from "node:path"
import { serve } from "@hono/node-server"
import { BookMapPipeline } from "@reading-studio/generation"
import { fixtureOutlineProvider } from "@reading-studio/generation/outline"
import { queueGenerationStage } from "@reading-studio/generation/provider-stages"
import { queueQuestions } from "@reading-studio/generation/queue-questions"
import { openAuthStorage, openStorage } from "@reading-studio/storage"
import { z } from "zod"
import { createApp } from "./app.ts"
import { createServerAuth } from "./auth/auth.ts"
import { assertProvisionedOwner } from "./auth/owner.ts"
import { parseServerConfig } from "./config.ts"
import { productionIntake } from "./intake.ts"
import { loadStudioAssets } from "./studio-assets.ts"
import { syntheticIntake } from "./testing/synthetic-intake.ts"

const config = parseServerConfig(process.env)
const { PRIVATE_DATA_ROOT: privateDataRoot } = process.env
const privateRoot = resolve(z.string().trim().min(1).parse(privateDataRoot))
const storage = openAuthStorage(config.databasePath)
const sourceStorage = openStorage({
  databasePath: config.databasePath,
  privateDataRoot: privateRoot,
  runtimeRole: "api",
})
assertProvisionedOwner(storage)
const auth = createServerAuth(storage, {
  baseURL: config.authBaseURL,
  secret: config.authSecret,
  sessionExpiresIn: config.sessionExpiresIn,
})
const syntheticMode = process.env["STUDIO_SYNTHETIC_TEST_MODE"] === "enabled"
const app = createApp({
  studioAssets: loadStudioAssets(resolve(import.meta.dirname, "../../studio/dist")),
  reviewStorage: sourceStorage,
  sources: sourceStorage.sources,
  interviews: sourceStorage.interviews,
  briefs: sourceStorage.briefs,
  outlines: sourceStorage.outlines,
  workflow: sourceStorage.workflow,
  renderOutputsInWorker: true,
  upload: {
    root: privateRoot,
    onAccepted: syntheticMode
      ? syntheticIntake(sourceStorage, privateRoot)
      : productionIntake(sourceStorage, privateRoot),
  },
  onSetupSend: ({ setupId, grantId, ownerId, installationId }) => {
    const analysis = new BookMapPipeline({
      storage: sourceStorage,
      ownerId,
      installationId,
    }).prepare(setupId, grantId)
    if (!syntheticMode) queueQuestions(sourceStorage, setupId, grantId, analysis)
  },
  ...(!syntheticMode
    ? {
        onOutlineGenerate: (briefRevisionId: string, setupRevisionId: string, grantId: string) =>
          queueGenerationStage(sourceStorage, "outline", briefRevisionId, setupRevisionId, grantId),
        onOutlineRevision: (
          briefRevisionId: string,
          setupRevisionId: string,
          grantId: string,
          requestRevisionId: string,
        ) =>
          queueGenerationStage(
            sourceStorage,
            "outline",
            briefRevisionId,
            setupRevisionId,
            grantId,
            requestRevisionId,
          ),
        onOutlineApprove: (outlineRevisionId: string, setupRevisionId: string, grantId: string) =>
          queueGenerationStage(
            sourceStorage,
            "lesson",
            outlineRevisionId,
            setupRevisionId,
            grantId,
          ),
      }
    : {}),
  ...(syntheticMode
    ? {
        providerAvailable: () => true,
        outlineProvider: fixtureOutlineProvider,
      }
    : {}),
  auth: {
    handler: auth.handler,
    ownerId: async (headers) => (await auth.api.getSession({ headers }))?.user.id ?? null,
  },
  security: {
    apiBodyBytes: 1_048_576,
    loginBodyBytes: 16_384,
    loginRateLimit: { attempts: 5, windowMs: 60_000 },
    trustedOrigins: config.trustedOrigins,
    trustProxy: config.trustProxy,
    uploadBodyBytes: 52_428_800,
  },
})

const server = serve(
  {
    fetch: app.fetch,
    hostname: config.host,
    port: config.port,
  },
  (serverInfo) => {
    process.stdout.write(
      `Reading studio API listening on ${serverInfo.address}:${serverInfo.port}\n`,
    )
  },
)

process.once("SIGTERM", () => {
  server.close(() => {
    sourceStorage.close()
    storage.close()
  })
})
