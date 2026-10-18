import { randomUUID } from "node:crypto"
import {
  NormalizationRevisionId,
  SetupRevisionId,
  StudySetupRevision,
} from "@reading-studio/contracts"
import { translate, type UiLocale } from "@reading-studio/contracts/i18n"
import { configuredCredential, defaultSettings } from "@reading-studio/providers"
import type { SourceRepository, Storage } from "@reading-studio/storage"
import { setupResult, setupReview } from "@reading-studio/studio/study-setup"
import type { Context, Hono } from "hono"
import { z } from "zod"
import type { AppEnvironment } from "./middleware/access.ts"
import { offeredModels } from "./provider-connections.ts"
import { preflightStudyDecision } from "./study-preparation.ts"
import { Draft, selectSourceScope } from "./study-setup-input.ts"
import { configureSetupReadApi } from "./study-setup-read-api.ts"

const Decision = z.strictObject({
  decision: z.enum(["send", "revise", "cancel"]),
  includeOriginal: z.boolean().optional(),
})
type Options = {
  readonly sources: SourceRepository
  readonly storage?: Storage
  readonly available?: (provider: "openai" | "anthropic" | "openrouter" | "codex") => boolean
  readonly onSend?: (input: {
    readonly setupId: string
    readonly grantId: string
    readonly ownerId: string
    readonly installationId: string
  }) => void
}

export function configureStudySetup(app: Hono<AppEnvironment>, options: Options) {
  const { sources } = options
  app.use("/sources/:revision/setup/*", async (context, next) => {
    context.header("Referrer-Policy", "same-origin")
    await next()
  })
  app.use("/sources/:revision/setup", async (context, next) => {
    context.header("Referrer-Policy", "same-origin")
    await next()
  })
  const choices = (ownerId: string) => offeredModels(options.storage, ownerId)
  const available = async (
    provider: StudySetupRevision["analysis"]["provider"],
    model: string,
    ownerId: string,
  ) =>
    provider !== "openai" &&
    (await choices(ownerId)).some(
      (choice) => choice.provider === provider && choice.model === model,
    ) &&
    (provider !== "anthropic" ||
      (options.available?.(provider) ?? configuredCredential(provider) !== undefined))
  function owned(revision: string, ownerId: string) {
    const parsed = NormalizationRevisionId.safeParse(revision)
    if (!parsed.success) return null
    const normalization = sources.getNormalization(parsed.data)
    if (!normalization) return null
    const study = sources
      .listStudiesByEdition(normalization.editionId)
      .find((study) => study.ownerId === ownerId)
    return study ? { normalization, study } : null
  }
  const unavailable = (revision: string, locale: UiLocale = "en") =>
    setupResult({
      title: translate(locale, "setup.unavailable"),
      message: translate(locale, "setup.stale"),
      revision,
      locale,
    })
  configureSetupReadApi(app, sources, owned, available, unavailable, choices)
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
    const selection = selectSourceScope(source.normalization, parsed.data)
    switch (selection.kind) {
      case "error":
        return json
          ? context.json({ error: selection.message }, 400)
          : context.text(selection.message, 400)
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
  async function decideDraft(context: Context<AppEnvironment>) {
    const locale = context.req.query("lang") === "ja" ? "ja" : "en"
    const json = context.req.path.startsWith("/api/")
    if (!context.req.header("origin")) return context.text("Forbidden", 403)
    const revision = context.req.param("revision") ?? ""
    const source = owned(revision, context.get("ownerId"))
    const id = SetupRevisionId.safeParse(context.req.param("setup"))
    const decision = Decision.safeParse(
      json ? await context.req.json() : await context.req.parseBody({ all: true }),
    )
    const setup = id.success ? sources.getSetup(id.data) : null
    if (decision.success && decision.data.includeOriginal)
      return context.json({ error: "original-file-unavailable" }, 415)
    if (
      !source ||
      !setup ||
      !decision.success ||
      setup.studyId !== source.study.id ||
      setup.analysis.normalizationRevisionId !== revision ||
      sources.getLatestSetup(source.study.id)?.id !== setup.id ||
      sources.getGrant(`grant-${setup.id}`)
    )
      return json
        ? context.json({ error: "Setup unavailable" }, 409)
        : context.html(unavailable(revision, locale), 409)
    const refusal = await preflightStudyDecision(context, {
      setup,
      normalization: source.normalization,
      decision: decision.data.decision,
    })
    if (refusal) return refusal
    if (
      decision.data.decision === "send" &&
      !(await available(setup.analysis.provider, setup.analysis.model, context.get("ownerId")))
    )
      return json
        ? context.json({ error: "Selected provider unavailable" }, 503)
        : context.html(
            setupReview({ setup, normalization: source.normalization, available: false, locale }),
            503,
          )
    const installationId =
      sources.getInstallation(source.study.ownerId) ??
      sources.createInstallation({ id: randomUUID(), ownerId: source.study.ownerId })
    const grant = sources.appendGrant({
      id: `grant-${setup.id}`,
      kind: decision.data.decision === "send" ? "active" : "revoked",
      setupRevisionId: setup.id,
      installationId,
      ownerId: source.study.ownerId,
      categories: ["book-text", "derived-study-material", "reader-context"],
      approvedAt: new Date().toISOString(),
      ...(decision.data.decision === "send" ? {} : { revokedAt: new Date().toISOString() }),
    })
    if (decision.data.decision === "send") {
      options.onSend?.({
        setupId: setup.id,
        grantId: grant.id,
        ownerId: source.study.ownerId,
        installationId,
      })
    }
    switch (decision.data.decision) {
      case "revise":
        return json
          ? context.json({ decision: "revise" as const })
          : context.redirect(`/sources/${revision}/setup?lang=${locale}`, 303)
      case "cancel":
        return json
          ? context.json({ decision: "cancel" as const })
          : context.html(
              setupResult({
                title: translate(locale, "setup.cancelled"),
                message: translate(locale, "setup.cancelledNote"),
                revision,
                locale,
              }),
            )
      case "send":
        return json
          ? context.json({ decision: "send" as const, grantId: grant.id })
          : context.html(
              setupResult({
                title: translate(locale, "setup.approved"),
                message: translate(locale, "setup.approvedNote"),
                revision,
                locale,
                grantId: grant.id,
              }),
            )
      default:
        return assertNever(decision.data.decision)
    }
  }
  app.post("/sources/:revision/setup/:setup", decideDraft)
  app.post("/api/study-setup/:revision/:setup", decideDraft)
}
function assertNever(value: never): never {
  throw new TypeError(`Unknown setup decision: ${value}`)
}
