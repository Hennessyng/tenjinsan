import { JobId, SetupRevisionId } from "@reading-studio/contracts"
import { ExecutionTransitionError, type Storage } from "@reading-studio/storage"
import { Hono } from "hono"
import { z } from "zod"
import { OwnerJob, projectOwnerJobs } from "./job-projection.ts"
import type { AppEnvironment } from "./middleware/access.ts"

const Expected = z.strictObject({ expectedSetupRevisionId: SetupRevisionId })
const Resolution = Expected.extend({
  choice: z.enum(["stop-approved", "retry-approved"]),
  confirmation: z.enum(["stop-approved", "retry-approved"]),
  reason: z.string().trim().min(8).max(500),
}).refine((value) => value.choice === value.confirmation)

export function configureJobs(app: Hono<AppEnvironment>, storage: Storage): void {
  const routes = new Hono<AppEnvironment>()
  routes.onError((error, context) => {
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return context.json({ error: "Invalid job decision" }, 400)
    if (error instanceof ExecutionTransitionError)
      return context.json({ error: "Job changed; refresh before deciding" }, 409)
    throw error
  })
  routes.get("/", (context) => {
    context.header("Cache-Control", "private, no-store")
    return context.json(projectOwnerJobs(storage, context.get("ownerId")))
  })
  routes.post("/:job/:action", async (context) => {
    context.header("Cache-Control", "private, no-store")
    const id = JobId.safeParse(context.req.param("job"))
    if (!id.success) return context.json({ error: "Job unavailable" }, 404)
    const job = storage.execution.getJob(id.data)
    const ownerId = context.get("ownerId")
    const setup = job && storage.sources.getSetup(job.setupRevisionId)
    const installation = storage.sources.getInstallation(ownerId)
    if (
      !job ||
      !setup ||
      !storage.sources
        .listStudiesByEdition(setup.editionId)
        .some((study) => study.id === setup.studyId && study.ownerId === ownerId) ||
      job.grant.ownerId !== ownerId ||
      job.grant.installationId !== installation ||
      storage.sources.getGrant(job.grant.id)?.kind !== "active"
    )
      return context.json({ error: "Job unavailable" }, 404)
    const action = context.req.param("action")
    if (job.provider === "openai" && action !== "cancel")
      return context.json({ error: "Historical direct-OpenAI work cannot be dispatched" }, 409)
    if (action !== "cancel" && action !== "retry" && action !== "resolve")
      return context.json({ error: "Job action unavailable" }, 404)
    const input: unknown = await context.req.json()
    const parsed =
      action === "resolve" || (action === "cancel" && job.state === "running")
        ? Resolution.parse(input)
        : Expected.parse(input)
    if (
      parsed.expectedSetupRevisionId !== job.setupRevisionId ||
      storage.sources.getLatestSetup(setup.studyId)?.id !== job.setupRevisionId
    )
      return context.json({ error: "Study revision changed; review current approval" }, 409)
    const view = projectOwnerJobs(storage, ownerId).jobs.find((item) => item.id === job.id)
    if (!view) return context.json({ error: "Job unavailable" }, 404)
    let decision: "cancel" | "retry" | "stop-approved" | "retry-approved"
    let reason: string
    if (action === "cancel") {
      if (job.state !== "queued" && job.state !== "running" && job.state !== "paused")
        return context.json({ error: "Job changed; refresh before deciding" }, 409)
      if (job.state === "running") {
        const acknowledged = Resolution.safeParse(input)
        if (!acknowledged.success || acknowledged.data.choice !== "stop-approved")
          return context.json({ error: "Confirm accepted call may incur a charge" }, 400)
        reason = acknowledged.data.reason
      } else reason = "Owner requested cancellation"
      decision = "cancel"
    } else if (action === "retry") {
      if (!view.canRetry) return context.json({ error: "Retry not available" }, 409)
      decision = "retry"
      reason = "Owner approved an additional provider attempt"
    } else {
      if (!view.unknownAttemptId)
        return context.json({ error: "Unknown decision unavailable" }, 409)
      const resolution = Resolution.parse(input)
      if (
        resolution.choice === "retry-approved" &&
        (view.callBudgetRemaining === 0 || view.runBudgetRemaining === 0)
      )
        return context.json({ error: "Call budget exhausted" }, 409)
      decision = resolution.choice
      reason = resolution.reason
    }
    storage.execution.decideOwnerJob({
      jobId: job.id,
      ownerId,
      expectedSetupRevisionId: parsed.expectedSetupRevisionId,
      action: decision,
      reason,
    })
    const updated = projectOwnerJobs(storage, ownerId).jobs.find((item) => item.id === job.id)
    if (!updated) return context.json({ error: "Job unavailable" }, 404)
    return context.json(OwnerJob.parse(updated))
  })
  app.route("/api/study-jobs", routes)
}
