import type { NormalizationRevision, StudySetupRevision } from "@reading-studio/contracts"
import { SetupRevisionId } from "@reading-studio/contracts"
import type { SourceRepository } from "@reading-studio/storage"
import { setupChoices, type setupResult, setupReview } from "@reading-studio/studio/study-setup"
import type { Hono } from "hono"
import type { AppEnvironment } from "./middleware/access.ts"

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
  unavailable: (revision: string) => ReturnType<typeof setupResult>,
  choices: (
    ownerId: string,
  ) => Promise<readonly { provider: string; model: string; label: string }[]>,
): void {
  app.get("/sources/:revision/setup", async (context) => {
    const source = owned(context.req.param("revision"), context.get("ownerId"))
    return source
      ? context.html(
          setupChoices({
            normalization: source.normalization,
            choices: await choices(context.get("ownerId")),
          }),
        )
      : context.html(unavailable(context.req.param("revision")), 404)
  })
  app.get("/sources/:revision/setup/:setup", async (context) => {
    const revision = context.req.param("revision")
    const source = owned(revision, context.get("ownerId"))
    const id = SetupRevisionId.safeParse(context.req.param("setup"))
    const setup = id.success ? sources.getSetup(id.data) : null
    if (
      !source ||
      !setup ||
      setup.studyId !== source.study.id ||
      setup.analysis.normalizationRevisionId !== revision ||
      sources.getLatestSetup(source.study.id)?.id !== setup.id ||
      sources.getGrant(`grant-${setup.id}`)
    )
      return context.html(unavailable(revision), 409)
    return context.html(
      setupReview({
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
      sources.getLatestSetup(source.study.id)?.id !== setup.id ||
      sources.getGrant(`grant-${setup.id}`)
    )
      return context.json({ error: "Setup unavailable" }, 409)
    return context.json({
      setup,
      normalization: source.normalization,
      available: await available(
        setup.analysis.provider,
        setup.analysis.model,
        context.get("ownerId"),
      ),
    })
  })
}
