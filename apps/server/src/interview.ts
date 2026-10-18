import { StudyId } from "@reading-studio/contracts"
import { translate } from "@reading-studio/contracts/i18n"
import type { InterviewRepository } from "@reading-studio/storage"
import { interviewPage } from "@reading-studio/studio/interview"
import { sourcePage } from "@reading-studio/studio/source-viewer"
import type { Hono } from "hono"
import { html } from "hono/html"
import { configureInterviewApi, saveInterviewAnswer } from "./interview-api.ts"
import type { AppEnvironment } from "./middleware/access.ts"

export function configureInterview(app: Hono<AppEnvironment>, interviews: InterviewRepository) {
  configureInterviewApi(app, interviews)
  app.use("/interviews/*", async (context, next) => {
    context.header("Cache-Control", "private, no-store")
    context.header(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    )
    context.header("Referrer-Policy", "same-origin")
    context.header("X-Content-Type-Options", "nosniff")
    await next()
  })
  app.on(["GET", "POST"], "/interviews/:study", async (context) => {
    const language = context.req.query("lang") === "ja" ? "ja" : "en"
    const t = (key: Parameters<typeof translate>[1]) => translate(language, key)
    const id = StudyId.safeParse(context.req.param("study"))
    const definition = id.success ? interviews.owned(id.data, context.get("ownerId")) : null
    if (!definition)
      return context.html(
        sourcePage(
          t("interview.unavailable.title"),
          html`<h1>${t("interview.unavailable.title")}</h1><p>${t("interview.unavailable.body")}</p><a href="/sources?lang=${language}">${t("interview.unavailable.back")}</a>`,
          language,
        ),
        404,
      )
    const stepId = context.req.query("step")
    const render = (state: "view" | "saved" | "error") =>
      interviewPage({
        definition,
        answers: interviews.answers(definition.id),
        stepId,
        language,
        state,
      })
    if (context.req.method === "GET")
      return context.html(render(context.req.query("saved") === "1" ? "saved" : "view"))
    const body = await context.req.parseBody({ all: true })
    const result = saveInterviewAnswer(interviews, definition, body)
    if (result.kind !== "saved")
      return context.html(render("error"), result.kind === "invalid" ? 422 : 409)
    return context.redirect(
      `/interviews/${definition.studyId}?step=${encodeURIComponent(result.questionId)}&lang=${language}&saved=1`,
      303,
    )
  })
  app.get("/interviews", (context) => {
    const language = context.req.query("lang") === "ja" ? "ja" : "en"
    const t = (key: Parameters<typeof translate>[1]) => translate(language, key)
    const definitions = interviews.listOwned(context.get("ownerId"))
    return context.html(
      sourcePage(
        t("interview.list.title"),
        html`<h1>${t("interview.list.title")}</h1>
       ${definitions.length === 0 ? html`<p>${t("interview.list.empty")}</p>` : html`<ul>${definitions.map((definition) => html`<li><a href="/interviews/${definition.studyId}?lang=${language}">${definition.steps[0]?.question.prompt[language]}</a></li>`)}</ul>`}`,
        language,
      ),
    )
  })
}
