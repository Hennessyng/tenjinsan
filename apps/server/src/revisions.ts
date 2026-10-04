import { randomUUID } from "node:crypto"
import { SetupRevisionId, StudyId, TransmissionCategory } from "@reading-studio/contracts"
import { ContractBoundaryError, type Storage } from "@reading-studio/storage"
import { Hono } from "hono"
import { z } from "zod"
import type { AppEnvironment } from "./middleware/access.ts"

const Consent = z.strictObject({
  expectedSetupRevisionId: SetupRevisionId,
  categories: z.array(TransmissionCategory).min(1),
})
const Expected = z.strictObject({ expectedSetupRevisionId: SetupRevisionId })

export function configureRevisions(app: Hono<AppEnvironment>, storage: Storage) {
  const routes = new Hono<AppEnvironment>()
  routes.onError((error, context) => {
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return context.json({ error: "Invalid revision request" }, 400)
    if (error instanceof ContractBoundaryError)
      return context.json({ error: "Unavailable or stale study revision" }, 409)
    throw error
  })
  routes.get("/current", (context) =>
    context.json(
      storage.revisions.current({
        studyId: StudyId.parse(context.req.param("study")),
        ownerId: context.get("ownerId"),
      }),
    ),
  )
  routes.post("/fork", async (context) => {
    const input = Expected.parse(await context.req.json())
    return context.json(
      storage.revisions.fork({
        ...input,
        studyId: context.req.param("study"),
        ownerId: context.get("ownerId"),
      }),
      201,
    )
  })
  routes.post("/setup", async (context) => {
    const input = z.record(z.string(), z.unknown()).parse(await context.req.json())
    return context.json(
      storage.revisions.revise({
        ...input,
        studyId: context.req.param("study"),
        ownerId: context.get("ownerId"),
      }),
      201,
    )
  })
  routes.post("/grant", async (context) => {
    const input = Consent.parse(await context.req.json())
    const ownerId = context.get("ownerId")
    const current = storage.revisions.current({ studyId: context.req.param("study"), ownerId })
    if (input.expectedSetupRevisionId !== current.setup.id || current.grant)
      return context.json({ error: "Stale transmission decision" }, 409)
    const installationId =
      storage.sources.getInstallation(ownerId) ??
      storage.sources.createInstallation({ id: randomUUID(), ownerId })
    return context.json(
      storage.sources.appendGrant({
        id: `grant-${current.setup.id}`,
        kind: "active",
        setupRevisionId: current.setup.id,
        installationId,
        ownerId,
        categories: input.categories,
        approvedAt: new Date().toISOString(),
      }),
      201,
    )
  })
  app.route("/api/revisions/:study", routes)
}
