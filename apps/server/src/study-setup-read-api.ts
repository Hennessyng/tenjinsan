import type { NormalizationRevision, StudySetupRevision } from "@reading-studio/contracts"
import { SetupRevisionId } from "@reading-studio/contracts"
import type { UiLocale } from "@reading-studio/contracts/i18n"
import type { SourceRepository } from "@reading-studio/storage"
import { setupChoices, type setupResult, setupReview } from "@reading-studio/studio/study-setup"
import type { Context, Hono } from "hono"
import type { AppEnvironment } from "./middleware/access.ts"
import type { savedSetupDecision } from "./study-setup-send.ts"

type Owned = {
  readonly normalization: NormalizationRevision
  readonly study: { readonly id: string }
}

export function configureSetupReadApi(
  app: Hono<AppEnvironment>,
  sources: SourceRepository,
  owned: (revision: string, ownerId: string) => Owned | null,
  available: (
    provider: StudySetupRevision["analysis"]["provider"],
    model: string,
    ownerId: string,
  ) => Promise<boolean>,
  unavailable: (revision: string, locale?: UiLocale) => ReturnType<typeof setupResult>,
  choices: (
    ownerId: string,
  ) => Promise<readonly { provider: string; model: string; label: string }[]>,
  savedDecision: (
    setup: StudySetupRevision,
    grantId: string,
    context: Context<AppEnvironment>,
  ) => ReturnType<typeof savedSetupDecision>,
): void {
  app.get("/sources/:revision/setup", async (context) => {
    const locale = context.req.query("lang") === "ja" ? "ja" : "en"
    const source = owned(context.req.param("revision"), context.get("ownerId"))
    return source
      ? context.html(
          setupChoices({
            normalization: source.normalization,
            choices: await choices(context.get("ownerId")),
            locale,
          }),
        )
      : context.html(unavailable(context.req.param("revision"), locale), 404)
  })
  app.get("/sources/:revision/setup/:setup", async (context) => {
    const locale = context.req.query("lang") === "ja" ? "ja" : "en"
    const revision = context.req.param("revision")
    const source = owned(revision, context.get("ownerId"))
    const id = SetupRevisionId.safeParse(context.req.param("setup"))
    const setup = id.success ? sources.getSetup(id.data) : null
    if (
      !source ||
      !setup ||
      setup.studyId !== source.study.id ||
      setup.analysis.normalizationRevisionId !== revision ||
      sources.getLatestSetup(source.study.id)?.id !== setup.id
    )
      return context.html(unavailable(revision, locale), 409)
    const grant = sources.getGrant(`grant-${setup.id}`)
    if (grant?.kind === "active")
      return context.redirect(`/jobs?setup=${encodeURIComponent(setup.id)}`, 303)
    if (grant) return context.html(unavailable(revision, locale), 409)
    return context.html(
      setupReview({
        locale,
        setup,
        normalization: source.normalization,
        available: await available(
          setup.analysis.provider,
          setup.analysis.model,
          context.get("ownerId"),
        ),
      }),
    )
  })
  app.get("/api/study-setup/:revision", async (context) => {
    context.header("Cache-Control", "private, no-store")
    const source = owned(context.req.param("revision"), context.get("ownerId"))
    return source
      ? context.json({
          normalization: source.normalization,
          choices: await choices(context.get("ownerId")),
        })
      : context.json({ error: "Setup unavailable" }, 404)
  })
  app.get("/api/study-setup/:revision/:setup", async (context) => {
    context.header("Cache-Control", "private, no-store")
    const source = owned(context.req.param("revision"), context.get("ownerId"))
    const id = SetupRevisionId.safeParse(context.req.param("setup"))
    const setup = id.success ? sources.getSetup(id.data) : null
    if (
      !source ||
      !setup ||
      setup.studyId !== source.study.id ||
      setup.analysis.normalizationRevisionId !== source.normalization.id ||
      sources.getLatestSetup(source.study.id)?.id !== setup.id
    )
      return context.json({ error: "Setup unavailable" }, 409)
    const grant = sources.getGrant(`grant-${setup.id}`)
    if (grant?.kind === "active") return context.json(savedDecision(setup, grant.id, context))
    if (grant) return context.json({ error: "Setup unavailable" }, 409)
    return context.json({
      setup,
      normalization: source.normalization,
      attachment: { status: "unavailable", reason: "exact-format-support-unverified" },
      available: await available(
        setup.analysis.provider,
        setup.analysis.model,
        context.get("ownerId"),
      ),
    })
  })
}
