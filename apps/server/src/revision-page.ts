import { randomUUID } from "node:crypto"
import { assertNever, SetupRevisionId, StudyId } from "@reading-studio/contracts"
import { configuredCredential } from "@reading-studio/providers"
import { ContractBoundaryError, type Storage } from "@reading-studio/storage"
import { revisionPage } from "@reading-studio/studio/revisions"
import { sourcePage } from "@reading-studio/studio/source-viewer"
import type { Context, Hono } from "hono"
import { html } from "hono/html"
import { z } from "zod"
import type { AppEnvironment } from "./middleware/access.ts"
import { offeredModels } from "./provider-connections.ts"

const Expected = z.strictObject({ expectedSetupRevisionId: SetupRevisionId })
const Decision = z.discriminatedUnion("action", [
  Expected.extend({ action: z.literal("fork") }),
  Expected.extend({
    action: z.literal("provider"),
    provider: z.enum(["openrouter", "codex", "anthropic"]),
    model: z.string().optional(),
  }),
  Expected.extend({ action: z.literal("consent") }),
])
type Options = {
  readonly storage: Storage
  readonly available?: (provider: "openai" | "anthropic" | "openrouter" | "codex") => boolean
}

export function configureRevisionPage(app: Hono<AppEnvironment>, options: Options) {
  const { storage } = options
  app.use("/revisions/*", async (context, next) => {
    context.header("Cache-Control", "private, no-store")
    context.header(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    )
    context.header("Referrer-Policy", "same-origin")
    context.header("X-Content-Type-Options", "nosniff")
    await next()
  })
  const handle = async (context: Context<AppEnvironment>) => {
    const json = context.req.path.startsWith("/api/")
    if (json) context.header("Cache-Control", "private, no-store")
    const id = StudyId.safeParse(context.req.param("study"))
    const ownerId = context.get("ownerId")
    const modelChoices = await offeredModels(storage, ownerId)
    const available = (provider: "openai" | "anthropic" | "openrouter" | "codex", model: string) =>
      modelChoices.some((choice) => choice.provider === provider && choice.model === model) &&
      (provider !== "anthropic" ||
        (options.available?.(provider) ?? configuredCredential(provider) !== undefined))
    const current = () =>
      storage.revisions.current({ studyId: id.success ? id.data : null, ownerId })
    try {
      current()
    } catch (error) {
      if (!(error instanceof ContractBoundaryError || error instanceof z.ZodError)) throw error
      return json
        ? context.json({ error: "Study unavailable" }, 404)
        : context.html(
            sourcePage(
              "Study unavailable",
              html`<h1>Study unavailable / 読書が見つかりません</h1><a href="/interviews">Return to interviews / 質問に戻る</a>`,
            ),
            404,
          )
    }
    const render = (error = false) => {
      const view = current()
      const interview = storage.interviews.latest(view.setup.studyId)
      return revisionPage(view, {
        available: available(view.setup.analysis.provider, view.setup.analysis.model),
        error,
        canEdit: interview !== null && interview.analysisRevisionId === view.analysis?.id,
        choices: modelChoices,
      })
    }
    const state = () => {
      const view = current()
      const interview = storage.interviews.latest(view.setup.studyId)
      return {
        view,
        available: available(view.setup.analysis.provider, view.setup.analysis.model),
        canEdit: interview !== null && interview.analysisRevisionId === view.analysis?.id,
        choices: modelChoices,
      }
    }
    const conflict = (status: 409 | 503 = 409) =>
      json
        ? context.json({ error: "This decision is stale or unavailable" }, status)
        : context.html(render(true), status)
    if (context.req.method === "GET") return json ? context.json(state()) : context.html(render())
    const parsed = Decision.safeParse(
      json ? await context.req.json() : await context.req.parseBody({ all: true }),
    )
    if (!parsed.success)
      return json
        ? context.json({ error: "Invalid revision decision" }, 422)
        : context.html(render(true), 422)
    const decision = parsed.data
    const view = current()
    const identity = {
      studyId: view.setup.studyId,
      ownerId,
      expectedSetupRevisionId: decision.expectedSetupRevisionId,
    }
    if (view.setup.id !== decision.expectedSetupRevisionId) return conflict()
    try {
      switch (decision.action) {
        case "fork": {
          const fork = storage.revisions.fork(identity)
          return json
            ? context.json({ forkStudyId: fork.setup.studyId })
            : context.redirect(`/revisions/${fork.setup.studyId}`, 303)
        }
        case "provider": {
          const choice = modelChoices.find(
            (choice) =>
              choice.provider === decision.provider &&
              (decision.model === undefined
                ? decision.provider === "anthropic"
                : choice.model === decision.model),
          )
          if (!choice)
            return json
              ? context.json({ error: "Unsupported provider" }, 422)
              : context.html(render(true), 422)
          storage.revisions.revise({
            ...identity,
            analysis: { ...view.setup.analysis, provider: choice.provider, model: choice.model },
            generation: view.setup.generation,
          })
          break
        }
        case "consent": {
          if (view.grant) return conflict()
          if (!available(view.setup.analysis.provider, view.setup.analysis.model))
            return conflict(503)
          const installationId =
            storage.sources.getInstallation(ownerId) ??
            storage.sources.createInstallation({ id: randomUUID(), ownerId })
          storage.sources.appendGrant({
            id: `grant-${view.setup.id}`,
            kind: "active",
            setupRevisionId: view.setup.id,
            installationId,
            ownerId,
            categories: ["book-text"],
            approvedAt: new Date().toISOString(),
          })
          break
        }
        default:
          return assertNever(decision)
      }
    } catch (error) {
      if (error instanceof ContractBoundaryError || error instanceof z.ZodError) return conflict()
      throw error
    }
    return json ? context.json(state()) : context.redirect(`/revisions/${view.setup.studyId}`, 303)
  }
  app.on(["GET", "POST"], "/revisions/:study", handle)
  app.on(["GET", "POST"], "/api/revision-page/:study", handle)
}
