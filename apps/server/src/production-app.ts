import { fixtureOutlineProvider } from "@reading-studio/generation/outline"
import { queueGenerationStage } from "@reading-studio/generation/provider-stages"
import type { VerifiedRouteCapacity } from "@reading-studio/providers"
import type { Storage } from "@reading-studio/storage"
import { createApp } from "./app.ts"
import type { ServerConfig } from "./config.ts"
import { productionIntake } from "./intake.ts"
import type { StudioAssets } from "./studio-assets.ts"
import { studySetupSend } from "./study-setup-send.ts"
import { localSubscriptionAccess } from "./subscriptions.ts"
import { syntheticIntake } from "./testing/synthetic-intake.ts"

export type ProductionApplication = {
  readonly storage: Storage
  readonly config: ServerConfig
  readonly privateRoot: string
  readonly assets?: StudioAssets
  readonly capacity?: VerifiedRouteCapacity
  readonly syntheticMode?: boolean
}

export function createProductionApplication(input: ProductionApplication) {
  const { storage, config, privateRoot } = input
  const synthetic = input.syntheticMode ?? false
  return createApp({
    serverHost: config.host,
    ...(input.assets ? { studioAssets: input.assets } : {}),
    reviewStorage: storage,
    sources: storage.sources,
    interviews: storage.interviews,
    briefs: storage.briefs,
    outlines: storage.outlines,
    workflow: storage.workflow,
    renderOutputsInWorker: true,
    libraryOwnerId: storage.libraryOwnerId(),
    ...(input.capacity ? { bookMapCapacity: input.capacity } : {}),
    upload: {
      root: privateRoot,
      onAccepted: synthetic
        ? syntheticIntake(storage, privateRoot)
        : productionIntake(storage, privateRoot),
    },
    onSetupSend: studySetupSend(storage, !synthetic, {
      localSubscriptions: localSubscriptionAccess(config.host, config),
      ...(input.capacity ? { capacity: input.capacity } : {}),
    }),
    ...(!synthetic
      ? {
          onOutlineGenerate: (brief: string, setup: string, grant: string) =>
            queueGenerationStage(storage, "outline", brief, setup, grant),
          onOutlineRevision: (brief: string, setup: string, grant: string, request: string) =>
            queueGenerationStage(storage, "outline", brief, setup, grant, request),
          onOutlineApprove: (outline: string, setup: string, grant: string) =>
            queueGenerationStage(storage, "lesson", outline, setup, grant),
        }
      : { providerAvailable: () => true, outlineProvider: fixtureOutlineProvider }),
    security: {
      apiBodyBytes: 1_048_576,
      loginBodyBytes: 16_384,
      loginRateLimit: { attempts: 5, windowMs: 60000 },
      trustedOrigins: config.trustedOrigins,
      trustProxy: config.trustProxy,
      uploadBodyBytes: 52_428_800,
    },
  })
}
