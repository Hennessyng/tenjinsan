import type { OutlineFixtureProvider } from "@reading-studio/generation/outline"
import { DEFAULT_ARCHIVE_LIMITS } from "@reading-studio/ingestion/archive"
import type {
  BriefRepository,
  InterviewRepository,
  OutlineRepository,
  SourceRepository,
  Storage,
  WorkflowRepository,
} from "@reading-studio/storage"
import { Hono } from "hono"
import { configureBrief } from "./brief.ts"
import { configureEvidence } from "./evidence.ts"
import { configureInterview } from "./interview.ts"
import { configureInterviewReadiness } from "./interview-readiness.ts"
import { configureJobs } from "./jobs.ts"
import { configureLibraryContext } from "./library-context.ts"
import {
  type AppEnvironment,
  createAccessMiddleware,
  type SecurityConfig,
} from "./middleware/access.ts"
import { configureOutline } from "./outline.ts"
import { configureProviderConnections } from "./provider-connections.ts"
import { configurePublication } from "./publication.ts"
import { configureRevisionPage } from "./revision-page.ts"
import { configureRevisions } from "./revisions.ts"
import { configureSourceViewer } from "./source-viewer.ts"
import {
  configureRoomOwnerGuards,
  configureStudioAssets,
  type StudioAssets,
  studioResponse,
} from "./studio-assets.ts"
import { configureStudySetup } from "./study-setup.ts"
import { configureSubscriptions, localSubscriptionAccess } from "./subscriptions.ts"
import { configureUpload, type UploadWithHook } from "./upload.ts"

export type { SecurityEvent } from "./middleware/access.ts"

type LegacyAuthFixture = {
  readonly handler: (request: Request) => Promise<Response>
  readonly ownerId: (headers: Headers) => Promise<string | null>
}

export type AppDependencies = {
  readonly serverHost?: string
  readonly studioAssets?: StudioAssets
  readonly reviewStorage?: Storage
  readonly auth?: LegacyAuthFixture
  readonly libraryOwnerId?: string
  readonly configurePrivateApi?: (app: Hono<AppEnvironment>) => void
  readonly security: SecurityConfig
  readonly upload?: UploadWithHook
  readonly sources?: SourceRepository
  readonly interviews?: InterviewRepository
  readonly briefs?: BriefRepository
  readonly outlines?: OutlineRepository
  readonly workflow?: WorkflowRepository
  readonly outlineProvider?: OutlineFixtureProvider
  readonly onOutlineGenerate?: (
    briefRevisionId: string,
    setupRevisionId: string,
    grantId: string,
  ) => void
  readonly onOutlineRevision?: (
    briefRevisionId: string,
    setupRevisionId: string,
    grantId: string,
    requestRevisionId: string,
  ) => void
  readonly onOutlineApprove?: (
    outlineRevisionId: string,
    setupRevisionId: string,
    grantId: string,
  ) => void
  readonly providerAvailable?: (
    provider: "openai" | "anthropic" | "openrouter" | "codex",
  ) => boolean
  readonly onSetupSend?: NonNullable<Parameters<typeof configureStudySetup>[1]["onSend"]>
  readonly renderOutputsInWorker?: boolean
}

export function createApp({
  serverHost,
  studioAssets,
  reviewStorage,
  libraryOwnerId: configuredOwnerId,
  configurePrivateApi,
  security,
  upload,
  sources,
  interviews,
  briefs,
  outlines,
  workflow,
  outlineProvider,
  onOutlineGenerate,
  onOutlineRevision,
  onOutlineApprove,
  providerAvailable,
  onSetupSend,
  renderOutputsInWorker,
}: AppDependencies) {
  const app = new Hono<AppEnvironment>()
  const access = createAccessMiddleware(security)
  const libraryOwnerId = configuredOwnerId ?? reviewStorage?.libraryOwnerId()
  app.use("*", access.requestBoundary)
  if (reviewStorage)
    app.use("*", async (context, next) => {
      if (context.req.path === "/health") return next()
      const admission = reviewStorage.maintenance.enter()
      if (admission === null) {
        return context.text("Library maintenance in progress", 503, { "Retry-After": "3" })
      }
      try {
        await next()
      } finally {
        reviewStorage.maintenance.leave(admission)
      }
    })
  app.get("/health", (context) => {
    const phase = reviewStorage?.maintenance.phase() ?? "idle"
    return context.json({
      status: "ok" as const,
      ...(phase === "idle" ? {} : { maintenance: phase }),
    })
  })

  for (const path of ["/login", "/logout"]) {
    app.get(path, (context) => context.redirect("/", 303))
    app.post(
      path,
      async (context, next) => {
        if (context.req.header("origin") === undefined) {
          access.record(context, {
            event: "access.origin",
            category: "origin",
            level: "warn",
            status: 403,
          })
          return context.text("Request rejected", 403)
        }
        return next()
      },
      access.loginBodyLimit,
      (context) => context.redirect("/", 303),
    )
  }
  app.get("/", (context) =>
    studioAssets
      ? studioResponse(context, studioAssets)
      : context.html(
          '<!doctype html><html lang="en"><head><title>Reading Studio</title></head><body><main><h1>Reading Studio</h1><p>This library has no authentication. Anyone who can reach this server can access it.</p><a href="/sources">Open library</a></main></body></html>',
        ),
  )
  app.all("/api/auth/*", access.loginBodyLimit, (context) =>
    context.json({ error: "Authentication has been removed" }, 410),
  )
  app.use("/api/*", access.libraryScope(libraryOwnerId, upload !== undefined))
  if (sources)
    configureLibraryContext(
      app,
      sources,
      security.trustedOrigins.some((origin) => new URL(origin).protocol === "https:"),
    )
  configureRoomOwnerGuards(app, access.libraryScope(libraryOwnerId), studioAssets !== undefined)
  app.use("/publication-artifacts/*", access.libraryScope(libraryOwnerId))
  if (studioAssets) configureStudioAssets(app, studioAssets)
  if (reviewStorage)
    configurePublication(app, reviewStorage, {
      ...(renderOutputsInWorker === undefined ? {} : { renderInWorker: renderOutputsInWorker }),
    })
  if (reviewStorage) configureRevisions(app, reviewStorage)
  if (reviewStorage) configureJobs(app, reviewStorage)
  if (reviewStorage) configureInterviewReadiness(app, reviewStorage)
  if (reviewStorage) configureProviderConnections(app, reviewStorage)
  if (reviewStorage)
    configureSubscriptions(app, {
      storage: reviewStorage,
      local: localSubscriptionAccess(serverHost, security),
    })
  if (reviewStorage)
    configureRevisionPage(app, {
      storage: reviewStorage,
      localSubscriptions: localSubscriptionAccess(serverHost, security),
      ...(providerAvailable ? { available: providerAvailable } : {}),
    })
  if (reviewStorage) configureEvidence(app, reviewStorage)
  if (outlines && briefs && interviews && workflow && sources)
    configureOutline(app, {
      outlines,
      briefs,
      interviews,
      workflow,
      sources,
      ...(outlineProvider ? { provider: outlineProvider } : {}),
      ...(onOutlineGenerate ? { onGenerate: onOutlineGenerate } : {}),
      ...(onOutlineRevision ? { onRevision: onOutlineRevision } : {}),
      ...(onOutlineApprove ? { onApprove: onOutlineApprove } : {}),
    })
  if (briefs && interviews && sources) configureBrief(app, { briefs, interviews, sources })
  if (interviews) configureInterview(app, interviews)
  if (sources !== undefined) configureSourceViewer(app, sources, upload?.root)
  if (sources !== undefined)
    configureStudySetup(app, {
      localSubscriptions: localSubscriptionAccess(serverHost, security),
      sources,
      ...(reviewStorage ? { storage: reviewStorage } : {}),
      ...(providerAvailable ? { available: providerAvailable } : {}),
      ...(onSetupSend ? { onSend: onSetupSend } : {}),
    })
  if (upload !== undefined) {
    const limits = upload.limits ?? DEFAULT_ARCHIVE_LIMITS
    configureUpload(app, {
      ...upload,
      limits: {
        ...limits,
        compressedBytes: Math.min(limits.compressedBytes, security.uploadBodyBytes),
      },
    })
  }
  configurePrivateApi?.(app)
  return app
}
