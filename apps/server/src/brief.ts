import { BriefContent, BriefDecision, BriefRevisionId, StudyId } from "@reading-studio/contracts"
import {
  type BriefRepository,
  ContractBoundaryError,
  type InterviewRepository,
  type SourceRepository,
} from "@reading-studio/storage"
import { briefPage } from "@reading-studio/studio/brief"
import { sourcePage } from "@reading-studio/studio/source-viewer"
import type { Context, Hono } from "hono"
import { html } from "hono/html"
import { z } from "zod"
import type { AppEnvironment } from "./middleware/access.ts"

const Form = z.strictObject({
  action: z.literal("save"),
  expectedRevisionId: z.string(),
  originalEn: z.string(),
  originalJa: z.string(),
  refinedEn: z.string(),
  refinedJa: z.string(),
  supportEn0: z.string(),
  supportJa0: z.string(),
  supportEn1: z.string(),
  supportJa1: z.string(),
  supportEn2: z.string(),
  supportJa2: z.string(),
  purpose: z.string(),
  context: z.string(),
  questionChoice: z.enum(["original", "refined"]),
  depth: z.enum(["overview", "focused", "deep"]),
  language: z.enum(["en", "ja", "paired"]),
  spoilerPolicy: z.enum(["allow", "avoid"]),
  exclusions: z.string(),
})
const Action = z.union([Form, BriefDecision.unwrap().omit({ studyId: true })])

export function configureBrief(
  app: Hono<AppEnvironment>,
  repositories: {
    readonly briefs: BriefRepository
    readonly interviews: InterviewRepository
    readonly sources: SourceRepository
  },
) {
  const { briefs, interviews, sources } = repositories
  app.use("/briefs/*", async (context, next) => {
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
    const definition = id.success ? interviews.owned(id.data, context.get("ownerId")) : null
    const setup = definition ? sources.getLatestSetup(definition.studyId) : null
    if (!definition || !setup)
      return json
        ? context.json({ error: "Brief unavailable" }, 404)
        : context.html(
            sourcePage(
              "Brief unavailable",
              html`<h1>Brief unavailable / 読書方針は未準備です</h1><p>A current setup and saved interview are required.</p><a href="/interviews">Return to interviews</a>`,
            ),
            404,
          )
    const render = (error = false) =>
      briefPage({
        view: briefs.current(definition.studyId),
        setup,
        edit: context.req.query("edit") === "1",
        error,
        descendants: briefs.descendants(definition.studyId),
      })
    if (context.req.method === "GET")
      return json
        ? context.json({
            view: briefs.current(definition.studyId),
            setup,
            descendants: briefs.descendants(definition.studyId),
          })
        : context.html(render())
    const parsed = Action.safeParse(
      json ? await context.req.json() : await context.req.parseBody({ all: true }),
    )
    if (!parsed.success)
      return json
        ? context.json({ error: "Invalid brief action" }, 422)
        : context.html(render(true), 422)
    try {
      const value = parsed.data
      switch (value.action) {
        case "save": {
          const supportingQuestions = [
            { en: value.supportEn0, ja: value.supportJa0 },
            { en: value.supportEn1, ja: value.supportJa1 },
            { en: value.supportEn2, ja: value.supportJa2 },
          ].filter((question) => question.en.trim() || question.ja.trim())
          const content = BriefContent.parse({
            originalQuestion: { en: value.originalEn, ja: value.originalJa },
            refinedQuestion:
              value.refinedEn.trim() || value.refinedJa.trim()
                ? { en: value.refinedEn, ja: value.refinedJa }
                : null,
            questionChoice: value.questionChoice,
            supportingQuestions,
            purpose: value.purpose,
            context: value.context,
            depth: value.depth,
            language: value.language,
            spoilerPolicy: value.spoilerPolicy,
            exclusions: value.exclusions
              .split("\n")
              .map((line) => line.trim())
              .filter(Boolean),
          })
          briefs.save({
            studyId: definition.studyId,
            expectedRevisionId: value.expectedRevisionId
              ? BriefRevisionId.parse(value.expectedRevisionId)
              : null,
            content,
          })
          break
        }
        case "approve":
        case "revise":
        case "defer":
          briefs.decide({ ...value, studyId: definition.studyId })
          break
        default: {
          const exhaustive: never = value
          return exhaustive
        }
      }
    } catch (error) {
      if (error instanceof ContractBoundaryError || error instanceof z.ZodError)
        return json
          ? context.json({ error: "Stale or incomplete brief" }, 409)
          : context.html(render(true), 409)
      throw error
    }
    return json
      ? context.json({
          view: briefs.current(definition.studyId),
          setup,
          descendants: briefs.descendants(definition.studyId),
        })
      : context.redirect(`/briefs/${definition.studyId}`, 303)
  }
  app.on(["GET", "POST"], "/briefs/:study", handle)
  app.on(["GET", "POST"], "/api/briefs/:study", handle)
}
