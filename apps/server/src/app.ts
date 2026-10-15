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
import { decorateGate } from "@reading-studio/studio/gate-artwork"
import { Hono } from "hono"
import { deleteCookie } from "hono/cookie"
import { adaptAuthRequest, loginPage, ownerPage, redirectWithCookies } from "./auth/login-page.ts"
import { configureLoginRoute } from "./auth/login-route.ts"
import { configureBrief } from "./brief.ts"
import { configureEvidence } from "./evidence.ts"
import { configureInterview } from "./interview.ts"
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
import { configureUpload, type UploadWithHook } from "./upload.ts"

export type { SecurityEvent } from "./middleware/access.ts"

type AppAuth = {
  readonly handler: (request: Request) => Promise<Response>
  readonly ownerId: (headers: Headers) => Promise<string | null>
}

export type AppDependencies = {
  readonly studioAssets?: StudioAssets
  readonly reviewStorage?: Storage
  readonly auth: AppAuth
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
  studioAssets,
  reviewStorage,
  auth,
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

  app.get("/login", async (context) => {
    if ((await auth.ownerId(context.req.raw.headers)) !== null) {
      return context.redirect("/", 303)
    }
    return context.html(loginPage())
  })

  app.get("/entrance-decoration.js", (context) =>
    context.body(`(${decorateGate.toString()})(document);`, 200, {
      "Content-Type": "text/javascript; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    }),
  )

  configureLoginRoute(app, access, auth.handler)

  app.post("/logout", async (context) => {
    if (context.req.header("origin") === undefined) {
      return context.text("Forbidden", 403)
    }
    const request = adaptAuthRequest(context.req.raw, "/api/auth/sign-out")
    const redirect = redirectWithCookies(await auth.handler(request), "/login")
    redirect.headers.append("Set-Cookie", "tj_entry=; Path=/; Max-Age=0; SameSite=Strict")
    return redirect
  })

  app.get("/", async (context) => {
    if ((await auth.ownerId(context.req.raw.headers)) === null) {
      return context.redirect("/login", 303)
    }
    return studioAssets ? studioResponse(context, studioAssets) : context.html(ownerPage())
  })

  app.use("/api/auth/sign-out", async (context, next) => {
    await next()
    if (context.res.ok)
      deleteCookie(context, "tj_study", { path: "/", httpOnly: true, sameSite: "Strict" })
  })
  app.on(["GET", "POST"], "/api/auth/*", (context) => auth.handler(context.req.raw))
  app.use("/api/*", access.requireOwner(auth.ownerId, upload !== undefined))
  if (sources)
    configureLibraryContext(
      app,
      sources,
      security.trustedOrigins.some((origin) => new URL(origin).protocol === "https:"),
    )
  configureRoomOwnerGuards(app, access.requireOwner(auth.ownerId), studioAssets !== undefined)
  app.use("/publication-artifacts/*", access.requireOwner(auth.ownerId))
  if (studioAssets) configureStudioAssets(app, studioAssets, auth.ownerId)
  if (reviewStorage)
    configurePublication(app, reviewStorage, {
      ...(renderOutputsInWorker === undefined ? {} : { renderInWorker: renderOutputsInWorker }),
    })
  if (reviewStorage) configureRevisions(app, reviewStorage)
  if (reviewStorage) configureJobs(app, reviewStorage)
  if (reviewStorage) configureProviderConnections(app, reviewStorage)
  if (reviewStorage)
    configureRevisionPage(app, {
      storage: reviewStorage,
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
