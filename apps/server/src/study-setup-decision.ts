import { randomUUID } from "node:crypto"
import { SetupRevisionId } from "@reading-studio/contracts"
import type { Context, Hono } from "hono"
import { z } from "zod"
import type { AppEnvironment } from "./middleware/access.ts"
import { checkSetupSend } from "./study-send-guards.ts"
import type { createSetupContext, SetupContextOptions } from "./study-setup-context.ts"
import { setupDecisionResponse } from "./study-setup-result.ts"
import {
  acceptSetupGrant,
  type SetupSendInput,
  savedSetupDecision,
  scheduleApprovedSetup,
} from "./study-setup-send.ts"

const Decision = z.strictObject({
  decision: z.enum(["send", "resume", "revise", "cancel"]),
  includeOriginal: z.boolean().optional(),
})
export type SetupDecisionOptions = SetupContextOptions & {
  readonly onSend?: (input: SetupSendInput) => void
}

export function configureSetupDecision(
  app: Hono<AppEnvironment>,
  options: SetupDecisionOptions,
  helpers: ReturnType<typeof createSetupContext>,
) {
  const { sources } = options
  async function decideDraft(context: Context<AppEnvironment>) {
    const locale = context.req.query("lang") === "ja" ? "ja" : "en"
    const json = context.req.path.startsWith("/api/")
    const revision = context.req.param("revision") ?? ""
    const unavailable = () =>
      json
        ? context.json({ error: "Setup unavailable" }, 409)
        : context.html(helpers.unavailable(revision, locale), 409)
    if (!context.req.header("origin")) return context.text("Forbidden", 403)
    const source = helpers.owned(revision, context.get("ownerId"))
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
      sources.getLatestSetup(source.study.id)?.id !== setup.id
    )
      return unavailable()
    const existing = sources.getGrant(`grant-${setup.id}`)
    const respond = (grantId: string) =>
      setupDecisionResponse(context, {
        decision: "send",
        setup,
        grantId,
        storage: options.storage,
        locale,
        localSubscriptions: options.localSubscriptions ?? false,
      })
    if (existing) {
      if (existing.kind !== "active") return unavailable()
      switch (decision.data.decision) {
        case "send":
          return respond(existing.id)
        case "revise":
        case "cancel":
          return unavailable()
        case "resume":
          if (!savedSetupDecision(options.storage, setup, existing.id).canResume)
            return respond(existing.id)
          break
        default:
          return assertNever(decision.data.decision)
      }
    } else if (decision.data.decision === "resume") return unavailable()
    if (decision.data.decision === "send" || decision.data.decision === "resume") {
      const refusal = await checkSetupSend(
        context,
        { ...options, available: helpers.available },
        { setup, normalization: source.normalization },
      )
      if (refusal) {
        if (!existing) return refusal.response
        options.storage?.setupScheduling.record({ grantId: existing.id, failure: refusal.code })
        return respond(existing.id)
      }
    }
    if (sources.getLatestSetup(setup.studyId)?.id !== setup.id) return unavailable()
    const installationId =
      sources.getInstallation(source.study.ownerId) ??
      sources.createInstallation({ id: randomUUID(), ownerId: source.study.ownerId })
    const sending = decision.data.decision === "send" || decision.data.decision === "resume"
    const accepted = acceptSetupGrant(sources, {
      id: `grant-${setup.id}`,
      kind: sending ? "active" : "revoked",
      setupRevisionId: setup.id,
      installationId,
      ownerId: source.study.ownerId,
      categories: ["book-text", "derived-study-material", "reader-context"],
      approvedAt: new Date().toISOString(),
      ...(setup.analysis.destination ? { destination: setup.analysis.destination } : {}),
      ...(sending ? {} : { revokedAt: new Date().toISOString() }),
    })
    if (!accepted) return unavailable()
    if (sending && (accepted.created || decision.data.decision === "resume")) {
      const failure = scheduleApprovedSetup(options.onSend, {
        setupId: setup.id,
        grantId: accepted.grant.id,
        ownerId: source.study.ownerId,
        installationId,
      })
      options.storage?.setupScheduling.record({ grantId: accepted.grant.id, failure })
    }
    return setupDecisionResponse(context, {
      decision: sending ? "send" : decision.data.decision === "cancel" ? "cancel" : "revise",
      setup,
      grantId: accepted.grant.id,
      storage: options.storage,
      locale,
      localSubscriptions: options.localSubscriptions ?? false,
    })
  }
  app.post("/sources/:revision/setup/:setup", decideDraft)
  app.post("/api/study-setup/:revision/:setup", decideDraft)
}

function assertNever(value: never): never {
  throw new TypeError(`Unknown setup decision: ${value}`)
}
