import { randomUUID } from "node:crypto"
import {
  assertNever,
  type EvidenceView,
  JobId,
  PublicationRevisionId,
  projectedStrings,
  StudyId,
} from "@reading-studio/contracts"
import { changeEvidenceReview, openEvidenceReview } from "@reading-studio/generation/review"
import { ContractBoundaryError, type Storage } from "@reading-studio/storage"
import { publicationPage } from "@reading-studio/studio/publication"
import type { Context, Hono } from "hono"
import { z } from "zod"
import type { AppEnvironment } from "./middleware/access.ts"
import { approvePublication, renderPublicationOutput } from "./publication-service.ts"

const Action = z.strictObject({
  expectedId: z.string().min(1),
  action: z.enum(["publish", "revise", "keep-private"]),
})

export function configurePublication(
  app: Hono<AppEnvironment>,
  storage: Storage,
  options: { readonly renderInWorker?: boolean } = {},
): void {
  app.use("/publications/*", async (context, next) => {
    context.header("Cache-Control", "private, no-store")
    context.header(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    )
    context.header("X-Content-Type-Options", "nosniff")
    await next()
  })
  const handle = async (context: Context<AppEnvironment>) => {
    const json = context.req.path.startsWith("/api/")
    if (json) context.header("Cache-Control", "private, no-store")
    const study = StudyId.safeParse(context.req.param("study"))
    if (!study.success || !storage.interviews.owned(study.data, context.get("ownerId")))
      return json ? context.json({ error: "Not found" }, 404) : context.text("Not found", 404)
    const state = (current: EvidenceView | null) => ({
      view: current,
      entries: current ? projectedStrings(current.draft.projection) : [],
      history: storage.publicationOutputs.list(study.data).map((snapshot) => ({
        snapshot,
        current: storage.publicationOutputs.current(snapshot),
        outputs: storage.publicationOutputs.outputs(snapshot.publication.id),
      })),
    })
    const id = storage.reviews.latestLessonId(study.data)
    let view: EvidenceView | null = null
    try {
      if (id) view = openEvidenceReview(storage, id)
    } catch (error) {
      if (!(error instanceof ContractBoundaryError)) throw error
    }
    if (context.req.method === "POST") {
      const action = Action.safeParse(
        json ? await context.req.json() : await context.req.parseBody({ all: true }),
      )
      if (!action.success)
        return json
          ? context.json({ error: "Invalid publication decision" }, 422)
          : context.text("Invalid publication decision", 422)
      try {
        const latest = storage.reviews.latestLessonId(study.data)
        view = latest ? openEvidenceReview(storage, latest) : null
      } catch (error) {
        if (!(error instanceof ContractBoundaryError)) throw error
        view = null
      }
      if (!view || view.draft.id !== action.data.expectedId)
        return json
          ? context.json({ error: "Stale review" }, 409)
          : context.text("Stale review; reload before deciding / 再読み込みしてください", 409)
      switch (action.data.action) {
        case "publish":
          if (!view.ready)
            return json
              ? context.json({ error: "Evidence or privacy review blocks publication" }, 409)
              : context.text("Evidence or privacy review blocks publication", 409)
          approvePublication(storage, view)
          break
        case "keep-private":
          changeEvidenceReview(storage, view.draft.lessonRevisionId, {
            ...action.data,
            action: "keep-private",
          })
          break
        case "revise":
          storage.reviews.append(
            { ...view.draft, id: randomUUID(), keepPrivate: false, privacyReviewed: false },
            view.draft.id,
          )
          return json
            ? context.json({ redirect: `/evidence/${study.data}/${view.draft.lessonRevisionId}` })
            : context.redirect(`/evidence/${study.data}/${view.draft.lessonRevisionId}`, 303)
        default:
          return assertNever(action.data.action)
      }
      return json
        ? context.json(state(openEvidenceReview(storage, view.draft.lessonRevisionId)))
        : context.redirect(`/publications/${study.data}`, 303)
    }
    const result = state(view)
    return json ? context.json(result) : context.html(publicationPage(view, result.history))
  }
  app.on(["GET", "POST"], "/publications/:study", handle)
  app.on(["GET", "POST"], "/api/publications/:study", handle)
  const generate = async (context: Context<AppEnvironment>) => {
    const json = context.req.path.startsWith("/api/")
    if (json) context.header("Cache-Control", "private, no-store")
    const study = StudyId.safeParse(context.req.param("study"))
    if (!study.success || !storage.interviews.owned(study.data, context.get("ownerId")))
      return json ? context.json({ error: "Not found" }, 404) : context.text("Not found", 404)
    const publicationId = PublicationRevisionId.safeParse(context.req.param("publication"))
    const snapshot = publicationId.success
      ? storage.publicationOutputs.get(publicationId.data)
      : null
    if (!snapshot || snapshot.evidence.draft.studyId !== study.data)
      return json ? context.json({ error: "Not found" }, 404) : context.text("Not found", 404)
    if (!storage.publicationOutputs.current(snapshot))
      return json
        ? context.json({ error: "Stale approval" }, 409)
        : context.text("Stale approval", 409)
    if (!options.renderInWorker)
      for (const output of storage.publicationOutputs.outputs(snapshot.publication.id))
        if (output.state === "queued") await renderPublicationOutput(storage, output)
    return json
      ? context.json({ generated: true as const })
      : context.redirect(`/publications/${study.data}`, 303)
  }
  app.post("/publications/:study/outputs/:publication", generate)
  app.post("/api/publications/:study/outputs/:publication", generate)
  app.get("/publication-artifacts/:job", (context) => {
    context.header("Cache-Control", "private, no-store")
    context.header("X-Content-Type-Options", "nosniff")
    context.header("Content-Security-Policy", "sandbox; default-src 'none'")
    const jobId = JobId.safeParse(context.req.param("job"))
    const output = jobId.success ? storage.publicationOutputs.output(jobId.data) : null
    const snapshot = output ? storage.publicationOutputs.get(output.publicationId) : null
    if (
      !snapshot ||
      !output ||
      !storage.interviews.owned(snapshot.evidence.draft.studyId, context.get("ownerId"))
    )
      return context.text("Not found", 404)
    try {
      const bytes = storage.publicationOutputs.download(output.id)
      if (!bytes) return context.text("Output unavailable", 409)
      context.header(
        "Content-Type",
        output.format === "html" ? "text/html; charset=utf-8" : "application/pdf",
      )
      context.header(
        "Content-Disposition",
        `attachment; filename="publication-${output.publicationId}.${output.format}"`,
      )
      context.header(
        "X-Publication-State",
        storage.publicationOutputs.current(snapshot) ? "current" : "stale",
      )
      return context.body(Buffer.from(bytes))
    } catch (error) {
      if (!(error instanceof ContractBoundaryError)) throw error
      return context.text("Artifact integrity error", 409)
    }
  })
}
