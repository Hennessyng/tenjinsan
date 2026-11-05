import {
  contentDigest,
  FullBookConsentError,
  type FullBookTestConsent,
  sameSubscriptionDestination,
  validateFullBookTestPlan,
  wholeBookScope,
} from "@reading-studio/contracts"
import { z } from "zod"
import type { StorageContext } from "./database.ts"
import type { SourceRepository } from "./sources.ts"

export function fullBookConsentAuthority(
  context: StorageContext,
  sources: SourceRepository,
  consent: FullBookTestConsent,
) {
  const { session } = consent,
    normalization = session.input.normalization
  validateFullBookTestPlan(session.input, session.plan)
  const stored = sources.getNormalization(normalization.id),
    edition = sources.getEdition(normalization.editionId)
  const study = sources
    .listStudiesByEdition(normalization.editionId)
    .find((study) => study.id === consent.studyId)
  const setup = sources.getLatestSetup(consent.studyId)
  const latest = z
    .object({ id: z.string() })
    .safeParse(
      context.sqlite
        .prepare(
          "SELECT id FROM normalization_revisions WHERE edition_id=? ORDER BY rowid DESC LIMIT 1",
        )
        .get(normalization.editionId),
    )
  const connection = context.sqlite
    .prepare(
      "SELECT revision FROM subscription_connections WHERE installation_id=? AND provider='chatgpt-subscription'",
    )
    .get(session.destination.installationId)
  const revision = connection
    ? z.object({ revision: z.number().int().nonnegative() }).parse(connection).revision
    : 0
  if (
    !study ||
    !latest.success ||
    latest.data.id !== normalization.id ||
    study.ownerId !== consent.ownerId ||
    !setup ||
    setup.id !== consent.setupRevisionId ||
    setup.editionId !== normalization.editionId ||
    setup.analysis.normalizationRevisionId !== normalization.id ||
    setup.analysis.editionHash !== normalization.editionHash ||
    setup.analysis.provider !== "chatgpt-subscription" ||
    setup.analysis.model !== session.model ||
    JSON.stringify(setup.analysis.settings) !== JSON.stringify(session.settings) ||
    !sameSubscriptionDestination(setup.analysis.destination, session.destination) ||
    sources.getInstallation(consent.ownerId) !== session.destination.installationId ||
    revision !== session.destination.connectionRevision
  )
    throw new FullBookConsentError("authority")
  if (
    !stored ||
    JSON.stringify(stored) !== JSON.stringify(normalization) ||
    edition?.originalHash !== normalization.editionHash ||
    JSON.stringify(wholeBookScope(stored)) !== JSON.stringify(setup.analysis.scope) ||
    consent.acknowledgement.coverage !== stored.coverage ||
    JSON.stringify(consent.acknowledgement.omissions) !== JSON.stringify(stored.omissions ?? [])
  )
    throw new FullBookConsentError("source")
  return contentDigest(JSON.stringify(setup))
}
