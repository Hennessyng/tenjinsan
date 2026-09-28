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
import { z } from "zod"
import { loginPage, ownerPage } from "./auth/login-page.ts"
import { configureBrief } from "./brief.ts"
import { configureEvidence } from "./evidence.ts"
import { configureInterview } from "./interview.ts"
import { configureJobs } from "./jobs.ts"
import {
  type AppEnvironment,
  createAccessMiddleware,
  type SecurityConfig,
} from "./middleware/access.ts"
import { configureOutline } from "./outline.ts"
import { configurePublication } from "./publication.ts"
import { configureRevisionPage } from "./revision-page.ts"
import { configureRevisions } from "./revisions.ts"
import { configureSourceViewer } from "./source-viewer.ts"
import { configureStudioAssets, type StudioAssets, studioResponse } from "./studio-assets.ts"
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
  readonly providerAvailable?: (provider: "openai" | "anthropic") => boolean
  readonly onSetupSend?: NonNullable<Parameters<typeof configureStudySetup>[1]["onSend"]>
  readonly renderOutputsInWorker?: boolean
}

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
})

function redirectWithCookies(authResponse: Response, location: string): Response {
  const headers = new Headers({ location })
  for (const cookie of authResponse.headers.getSetCookie()) {
    headers.append("set-cookie", cookie)
  }
  return new Response(null, { headers, status: 303 })
}

function adaptAuthRequest(request: Request, path: string, body?: string): Request {
  const headers = new Headers(request.headers)
  headers.delete("content-length")
  if (body === undefined) {
    return new Request(new URL(path, request.url), {
      headers,
      method: "POST",
      signal: request.signal,
    })
  }
  headers.set("content-type", "application/json")
  return new Request(new URL(path, request.url), {
    body,
    headers,
    method: "POST",
    signal: request.signal,
  })
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

  app.post("/login", access.loginRateLimit, access.loginBodyLimit, async (context) => {
    if (context.req.header("origin") === undefined) {
      return context.text("Forbidden", 403)
    }
    const parsed = loginSchema.safeParse(await context.req.parseBody())
    if (!parsed.success) {
      return context.html(loginPage(true), 401)
    }
    const request = adaptAuthRequest(
      context.req.raw,
      "/api/auth/sign-in/email",
      JSON.stringify(parsed.data),
    )
    const response = await auth.handler(request)
    if (!response.ok) {
      return context.html(loginPage(true), 401)
    }
    return redirectWithCookies(response, "/")
  })

  app.post("/logout", async (context) => {
    if (context.req.header("origin") === undefined) {
      return context.text("Forbidden", 403)
    }
    const request = adaptAuthRequest(context.req.raw, "/api/auth/sign-out")
    return redirectWithCookies(await auth.handler(request), "/login")
  })

  app.get("/", async (context) => {
    if ((await auth.ownerId(context.req.raw.headers)) === null) {
      return context.redirect("/login", 303)
    }
    return studioAssets ? studioResponse(context, studioAssets) : context.html(ownerPage())
  })

  app.use("/api/auth/sign-in/email", access.loginRateLimit, access.loginBodyLimit)
  app.on(["GET", "POST"], "/api/auth/*", (context) => auth.handler(context.req.raw))
  app.use("/api/*", access.requireOwner(auth.ownerId, upload !== undefined))
  app.use("/sources/*", access.requireOwner(auth.ownerId))
  app.use("/interviews/*", access.requireOwner(auth.ownerId))
  app.use("/briefs/*", access.requireOwner(auth.ownerId))
  app.use("/outlines/*", access.requireOwner(auth.ownerId))
  app.use("/evidence/*", access.requireOwner(auth.ownerId))
  app.use("/publications/*", access.requireOwner(auth.ownerId))
  app.use("/revisions/*", access.requireOwner(auth.ownerId))
  app.use("/publication-artifacts/*", access.requireOwner(auth.ownerId))
  if (studioAssets) configureStudioAssets(app, studioAssets, auth.ownerId)
  if (reviewStorage)
    configurePublication(app, reviewStorage, {
      ...(renderOutputsInWorker === undefined ? {} : { renderInWorker: renderOutputsInWorker }),
    })
  if (reviewStorage) configureRevisions(app, reviewStorage)
  if (reviewStorage) configureJobs(app, reviewStorage)
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
