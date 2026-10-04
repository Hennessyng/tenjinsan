import { createHash } from "node:crypto"
import {
  EvidenceAction,
  LessonRevisionId,
  projectedStrings,
  StudyId,
} from "@reading-studio/contracts"
import {
  changeEvidenceReview,
  lessonSources,
  openEvidenceReview,
} from "@reading-studio/generation/review"
import { ContractBoundaryError, type Storage } from "@reading-studio/storage"
import {
  evidencePage,
  evidencePreview,
  readerDocument,
  sceneRuntime,
  spatialRuntime,
} from "@reading-studio/studio/evidence"
import type { Context, Hono } from "hono"
import { z } from "zod"
import type { AppEnvironment } from "./middleware/access.ts"

export function configureEvidence(app: Hono<AppEnvironment>, storage: Storage) {
  app.get("/api/evidence/:study", (context) => {
    context.header("Cache-Control", "private, no-store")
    const study = StudyId.safeParse(context.req.param("study"))
    if (!study.success || !storage.interviews.owned(study.data, context.get("ownerId")))
      return context.json({ error: "Study not found" }, 404)
    const lessonId = storage.reviews.latestLessonId(study.data)
    return lessonId
      ? context.json({ lessonId })
      : context.json({ error: "No generated lesson" }, 404)
  })
  app.use("/evidence/*", async (context, next) => {
    context.header("Cache-Control", "private, no-store")
    context.header(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    )
    context.header("Referrer-Policy", "same-origin")
    context.header("X-Content-Type-Options", "nosniff")
    await next()
  })
  app.get("/evidence/:study", (context) => {
    const study = StudyId.safeParse(context.req.param("study"))
    if (!study.success || !storage.interviews.owned(study.data, context.get("ownerId")))
      return context.text("Study not found", 404)
    const lessonId = storage.reviews.latestLessonId(study.data)
    return lessonId
      ? context.redirect(`/evidence/${study.data}/${lessonId}`, 303)
      : context.text("No generated lesson to review / 確認する本文がありません", 404)
  })
  const handle = async (context: Context<AppEnvironment>) => {
    const json = context.req.path.startsWith("/api/")
    if (json) {
      context.header("Cache-Control", "private, no-store")
      context.header(
        "Content-Security-Policy",
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      )
      context.header("X-Content-Type-Options", "nosniff")
    }
    const study = StudyId.safeParse(context.req.param("study"))
    const id = LessonRevisionId.safeParse(context.req.param("lesson"))
    const lesson = id.success ? storage.workflow.getLesson(id.data) : null
    if (
      !study.success ||
      !lesson ||
      lesson.studyId !== study.data ||
      !storage.interviews.owned(study.data, context.get("ownerId"))
    )
      return json
        ? context.json({ error: "Lesson not found" }, 404)
        : context.text("Lesson not found", 404)
    const page = context.req.param("page")
    if (page !== undefined && page !== "preview" && page !== "read")
      return json ? context.json({ error: "Not found" }, 404) : context.text("Not found", 404)
    const references = [
      ...new Map(lessonSources(lesson).map((span) => [JSON.stringify(span), span])).values(),
    ].map((span) => {
      const normalization = storage.sources.getNormalization(span.normalizationRevisionId)
      const chapter =
        normalization?.resources.findIndex((resource) => resource.path === span.resourcePath) ?? -1
      return {
        title: `${span.resourcePath} · ${span.blockId} · ${span.start}–${span.end}`,
        href: `/sources/${span.normalizationRevisionId}?chapter=${chapter}#${span.blockId}`,
        text: span.originalFragment,
      }
    })
    try {
      const view = openEvidenceReview(storage, lesson.id)
      const state = (current: typeof view) => ({
        view: current,
        references,
        entries: projectedStrings(current.draft.projection),
        removable: current.draft.projection.sections.flatMap((section, index) => [
          `/sections/${index}`,
          ...section.scenes.map((_, i) => `/sections/${index}/scenes/${i}`),
          ...section.practice.map((_, i) => `/sections/${index}/practice/${i}`),
          ...section.sourceNotes.map((_, i) => `/sections/${index}/sourceNotes/${i}`),
        ]),
      })
      if (context.req.method === "GET" && page === "read") {
        const hash = createHash("sha256").update(sceneRuntime).digest("base64")
        const spatialHash = createHash("sha256").update(spatialRuntime).digest("base64")
        context.header(
          "Content-Security-Policy",
          `default-src 'none'; script-src 'sha256-${hash}' 'sha256-${spatialHash}'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`,
        )
        return context.html(readerDocument(view.draft.projection))
      }
      if (context.req.method === "GET")
        return json && page === undefined
          ? context.json(state(view))
          : context.html(
              page === "preview" ? evidencePreview(view) : evidencePage(view, false, references),
            )
      if (page !== undefined)
        return json
          ? context.json({ error: "Method not allowed" }, 405)
          : context.text("Method not allowed", 405)
      const action = EvidenceAction.safeParse(
        json ? await context.req.json() : await context.req.parseBody({ all: true }),
      )
      if (!action.success || action.data.action === "correct")
        return json
          ? context.json({ error: "Invalid review action" }, 422)
          : context.html(evidencePage(view, true, references), 422)
      try {
        changeEvidenceReview(storage, lesson.id, action.data)
      } catch (error) {
        if (error instanceof ContractBoundaryError || error instanceof z.ZodError)
          return json
            ? context.json({ error: "Stale review or unresolved finding" }, 409)
            : context.html(
                evidencePage(openEvidenceReview(storage, lesson.id), true, references),
                409,
              )
        throw error
      }
      return json
        ? context.json(state(openEvidenceReview(storage, lesson.id)))
        : context.redirect(`/evidence/${study.data}/${lesson.id}`, 303)
    } catch (error) {
      if (error instanceof ContractBoundaryError)
        return json
          ? context.json({ error: "Outdated lesson" }, 409)
          : context.text(
              "This lesson is outdated. Review the current approved outline and lesson.",
              409,
            )
      throw error
    }
  }
  app.on(["GET", "POST"], "/evidence/:study/:lesson/:page?", handle)
  app.on(["GET", "POST"], "/api/evidence/:study/:lesson/:page?", handle)
}
