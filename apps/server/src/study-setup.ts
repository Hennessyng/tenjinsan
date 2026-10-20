import { randomUUID } from "node:crypto"
import { isSubscriptionProvider, StudySetupRevision } from "@reading-studio/contracts"
import { defaultSettings } from "@reading-studio/providers"
import type { Context, Hono } from "hono"
import type { AppEnvironment } from "./middleware/access.ts"
import { subscriptionSendRefusal } from "./study-send-guards.ts"
import { createSetupContext } from "./study-setup-context.ts"
import { configureSetupDecision, type SetupDecisionOptions } from "./study-setup-decision.ts"
import { Draft, selectSourceScope } from "./study-setup-input.ts"
import { configureSetupReadApi } from "./study-setup-read-api.ts"
import { savedSetupDecision } from "./study-setup-send.ts"
import { selectedSubscription } from "./subscription-setup.ts"
import { hasForwardedHeaders } from "./subscriptions.ts"

export function configureStudySetup(app: Hono<AppEnvironment>, options: SetupDecisionOptions) {
  const { sources } = options
  app.use("/sources/:revision/setup/*", async (context, next) => {
    context.header("Referrer-Policy", "same-origin")
    await next()
  })
  app.use("/sources/:revision/setup", async (context, next) => {
    context.header("Referrer-Policy", "same-origin")
    await next()
  })
  const helpers = createSetupContext(options)
  const { choices, available, owned, unavailable } = helpers
  configureSetupDecision(app, options, helpers)
  configureSetupReadApi(
    app,
    sources,
    owned,
    available,
    unavailable,
    choices,
    (setup, grantId, context) => {
      const saved = savedSetupDecision(options.storage, setup, grantId)
      const refusal = subscriptionSendRefusal(context, options, setup)
      return refusal ? { ...saved, schedulingFailure: refusal, canResume: false } : saved
    },
  )
  async function createDraft(context: Context<AppEnvironment>) {
    const locale = context.req.query("lang") === "ja" ? "ja" : "en"
    const json = context.req.path.startsWith("/api/")
    if (!context.req.header("origin")) return context.text("Forbidden", 403)
    const revision = context.req.param("revision") ?? ""
    const source = owned(revision, context.get("ownerId"))
    if (!source)
      return json
        ? context.json({ error: "Setup unavailable" }, 404)
        : context.html(unavailable(revision, locale), 404)
    const parsed = Draft.safeParse(
      json ? await context.req.json() : await context.req.parseBody({ all: true }),
    )
    if (!parsed.success)
      return json
        ? context.json({ error: "Invalid setup choices" }, 400)
        : context.text("Invalid setup choices", 400)
    const { provider } = parsed.data
    if (
      isSubscriptionProvider(provider) &&
      (!options.localSubscriptions ||
        !selectedSubscription(options.storage, context.get("ownerId"), provider) ||
        hasForwardedHeaders(context.req.raw.headers))
    )
      return context.json({ error: "subscription-unverified", transmission: "not-sent" }, 409)
    const destination = selectedSubscription(options.storage, context.get("ownerId"), provider)
    const selection = selectSourceScope(source.normalization)
    switch (selection.kind) {
      case "error":
        return json
          ? context.json({ error: selection.message }, 422)
          : context.text(selection.message, 422)
      case "ready":
        break
      default:
        return assertNever(selection)
    }
    const choice = (await choices(context.get("ownerId"))).find(
      (choice) =>
        choice.provider === provider &&
        (parsed.data.model === undefined
          ? provider === "anthropic"
          : choice.model === parsed.data.model),
    )
    if (!choice)
      return json
        ? context.json({ error: "Unsupported model" }, 400)
        : context.text("Unsupported model", 400)
    const setup = StudySetupRevision.parse({
      id: randomUUID(),
      studyId: source.study.id,
      editionId: source.normalization.editionId,
      analysis: {
        editionHash: source.normalization.editionHash,
        normalizationRevisionId: source.normalization.id,
        scope: selection.scope,
        provider,
        model: choice.model,
        ...(destination ? { destination } : {}),
        analysisPromptVersion: "analysis-1",
        analysisSchemaVersion: "analysis-1",
        settings: defaultSettings,
      },
      generation: {
        promptVersion: "generation-1",
        schemaVersion: "generation-1",
        settings: defaultSettings,
      },
    })
    sources.appendSetup({
      record: setup,
      parentRevisionId: sources.getLatestSetup(source.study.id)?.id ?? null,
    })
    return json
      ? context.json({ setupId: setup.id }, 201)
      : context.redirect(`/sources/${revision}/setup/${setup.id}?lang=${locale}`, 303)
  }
  app.post("/sources/:revision/setup", createDraft)
  app.post("/api/study-setup/:revision", createDraft)
}
function assertNever(value: never): never {
  throw new TypeError(`Unknown setup decision: ${value}`)
}
