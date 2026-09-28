import { StudyId } from "@reading-studio/contracts"
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
    const id = StudyId.safeParse(context.req.param("study"))
    const definition = id.success ? interviews.owned(id.data, context.get("ownerId")) : null
    if (!definition)
      return context.html(
        sourcePage(
          "Interview unavailable",
          html`<h1>Interview unavailable / 質問は未準備です</h1><p>No saved question bank is available for this study.</p><a href="/sources">Return to sources</a>`,
        ),
        404,
      )
    const language = context.req.query("lang") === "ja" ? "ja" : "en"
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
    const definitions = interviews.listOwned(context.get("ownerId"))
    return context.html(
      sourcePage(
        "Reading interviews",
        html`<h1>Reading interviews / 読書の質問</h1>
      ${definitions.length === 0 ? html`<p>No question bank is ready yet. / 質問はまだ準備されていません。</p>` : html`<ul>${definitions.map((definition) => html`<li><a href="/interviews/${definition.studyId}">${definition.steps[0]?.question.prompt.en} / ${definition.steps[0]?.question.prompt.ja}</a></li>`)}</ul>`}`,
      ),
    )
  })
}
