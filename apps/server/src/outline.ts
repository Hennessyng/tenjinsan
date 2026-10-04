import {
  BriefRevisionId,
  OutlineDecision,
  OutlineFeedback,
  OutlineRevisionId,
  StudyId,
} from "@reading-studio/contracts"
import type { OutlineFixtureProvider } from "@reading-studio/generation/outline"
import {
  type BriefRepository,
  ContractBoundaryError,
  type InterviewRepository,
  type OutlineRepository,
  type SourceRepository,
  type WorkflowRepository,
} from "@reading-studio/storage"
import { outlinePage } from "@reading-studio/studio/outline"
import type { Context, Hono } from "hono"
import { z } from "zod"
import type { AppEnvironment } from "./middleware/access.ts"

const Action = z.union([
  z.strictObject({
    action: z.literal("generate"),
    briefRevisionId: BriefRevisionId,
    expectedRevisionId: z.string(),
  }),
  OutlineDecision.unwrap().omit({ studyId: true }),
  z.strictObject({
    action: z.literal("choice"),
    revisionId: OutlineRevisionId,
    value: z.enum(["reverse-order", "simplify-visuals"]),
  }),
  z.strictObject({
    action: z.literal("custom"),
    revisionId: OutlineRevisionId,
    text: z.string().trim().min(1).max(2000),
  }),
])

export function configureOutline(
  app: Hono<AppEnvironment>,
  dependencies: {
    readonly outlines: OutlineRepository
    readonly briefs: BriefRepository
    readonly interviews: InterviewRepository
    readonly workflow: WorkflowRepository
    readonly sources: SourceRepository
    readonly provider?: OutlineFixtureProvider
    readonly onGenerate?: (
      briefRevisionId: string,
      setupRevisionId: string,
      grantId: string,
    ) => void
    readonly onRevision?: (
      briefRevisionId: string,
      setupRevisionId: string,
      grantId: string,
      requestRevisionId: string,
    ) => void
    readonly onApprove?: (
      outlineRevisionId: string,
      setupRevisionId: string,
      grantId: string,
    ) => void
  },
) {
  const {
    outlines,
    briefs,
    interviews,
    workflow,
    sources,
    provider,
    onGenerate,
    onRevision,
    onApprove,
  } = dependencies
  app.use("/outlines/*", async (context, next) => {
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
    const owned = id.success ? interviews.owned(id.data, context.get("ownerId")) : null
    if (!owned)
      return json
        ? context.json({ error: "Study not found" }, 404)
        : context.text("Study not found", 404)
    const studyId = owned.studyId
    const briefView = briefs.current(studyId)
    const brief = briefView ? briefs.approved(briefView.draft.id) : null
    const render = (error = false) =>
      outlinePage({
        view: outlines.current(studyId),
        brief,
        scope: sources.getLatestSetup(studyId)?.analysis.scope ?? null,
        studyId,
        fixture: provider !== undefined,
        providerReady: onGenerate !== undefined,
        error,
      })
    const state = () => ({
      view: outlines.current(studyId),
      brief: brief
        ? {
            id: brief.id,
            guidingQuestion: brief.guidingQuestion,
            supportingQuestions: brief.supportingQuestions,
          }
        : null,
      scope: sources.getLatestSetup(studyId)?.analysis.scope ?? null,
      fixture: provider !== undefined,
      providerReady: onGenerate !== undefined,
    })
    const conflict = () =>
      json
        ? context.json({ error: "Stale revision, missing approval or unresolved flags" }, 409)
        : context.html(render(true), 409)
    if (context.req.method === "GET") return json ? context.json(state()) : context.html(render())
    const parsed = Action.safeParse(
      json ? await context.req.json() : await context.req.parseBody({ all: true }),
    )
    if (!parsed.success)
      return json
        ? context.json({ error: "Invalid outline action" }, 422)
        : context.html(render(true), 422)
    const action = parsed.data
    try {
      switch (action.action) {
        case "approve":
        case "revise":
        case "defer":
          if (action.action === "approve" && onApprove) {
            const pending = outlines.current(studyId)
            const grant =
              pending && sources.getGrant(`grant-${sources.getLatestSetup(studyId)?.id}`)
            if (grant?.kind !== "active") return conflict()
          }
          outlines.decide({ ...action, studyId })
          if (action.action === "approve" && onApprove) {
            const approved = outlines.approved(action.revisionId)
            if (!approved) return conflict()
            const grant = sources.getGrant(`grant-${approved.setupRevisionId}`)
            if (grant?.kind !== "active") return conflict()
            onApprove(approved.id, approved.setupRevisionId, grant.id)
          }
          break
        case "generate":
        case "choice":
        case "custom": {
          if ((!provider && !onGenerate) || !brief) return conflict()
          const current = outlines.current(studyId)
          const expected =
            action.action === "generate" ? action.expectedRevisionId || null : action.revisionId
          if (
            (current?.draft.id ?? null) !== expected ||
            (action.action === "generate" && action.briefRevisionId !== brief.id)
          )
            return conflict()
          const analysis = workflow.getAnalysis(brief.analysisRevisionId)
          if (!analysis) return conflict()
          if (action.action === "generate" && onGenerate && !provider) {
            const grant = sources.getGrant(`grant-${brief.setupRevisionId}`)
            if (grant?.kind !== "active") return conflict()
            onGenerate(brief.id, brief.setupRevisionId, grant.id)
            break
          }
          if (action.action !== "generate" && onRevision && !provider && current) {
            const grant = sources.getGrant(`grant-${brief.setupRevisionId}`)
            if (grant?.kind !== "active") return conflict()
            const feedback = OutlineFeedback.parse(
              action.action === "choice"
                ? { kind: "choice", value: action.value }
                : { kind: "custom", text: action.text },
            )
            const request = outlines.save({
              studyId,
              briefRevisionId: brief.id,
              expectedRevisionId: current.draft.id,
              content: current.draft.content,
              feedback,
            })
            onRevision(brief.id, brief.setupRevisionId, grant.id, request.id)
            break
          }
          if (!provider) return conflict()
          const feedback =
            action.action === "generate"
              ? null
              : OutlineFeedback.parse(
                  action.action === "choice"
                    ? { kind: "choice", value: action.value }
                    : { kind: "custom", text: action.text },
                )
          const content = provider({
            brief,
            analysis,
            previous: action.action === "generate" ? null : (current?.draft.content ?? null),
            feedback,
          })
          outlines.save({
            studyId,
            briefRevisionId: brief.id,
            expectedRevisionId: expected,
            content,
            feedback,
          })
          break
        }
        default: {
          const exhaustive: never = action
          return exhaustive
        }
      }
    } catch (error) {
      if (error instanceof ContractBoundaryError || error instanceof z.ZodError) return conflict()
      throw error
    }
    return json ? context.json(state()) : context.redirect(`/outlines/${studyId}`, 303)
  }
  app.on(["GET", "POST"], "/outlines/:study", handle)
  app.on(["GET", "POST"], "/api/outlines/:study", handle)
}
