import { analysisCacheKey, StudyId } from "@reading-studio/contracts"
import { InterviewReadiness } from "@reading-studio/contracts/interview"
import type { Storage } from "@reading-studio/storage"
import type { Hono } from "hono"
import { projectOwnerJobs } from "./job-projection.ts"
import type { AppEnvironment } from "./middleware/access.ts"

const stateOrder: Readonly<Record<string, number>> = {
  "historical-inert": 0,
  failed: 1,
  paused: 2,
  cancelled: 3,
  running: 4,
  queued: 5,
}

export function interviewReadiness(
  storage: Storage,
  ownerId: string,
  studyId: string,
): InterviewReadiness {
  const id = StudyId.safeParse(studyId)
  if (!id.success) return { kind: "missing-study" }
  if (storage.interviews.owned(id.data, ownerId))
    return { kind: "ready", actionHref: `/interviews/${encodeURIComponent(studyId)}` }
  const document = storage.sources
    .listDocuments(ownerId)
    .find(({ edition }) =>
      storage.sources
        .listStudiesByEdition(edition.id)
        .some((study) => study.id === id.data && study.ownerId === ownerId),
    )
  if (!document) return { kind: "missing-study" }
  const setup = storage.sources.getLatestSetup(id.data)
  if (!setup)
    return {
      kind: "setup-required",
      actionHref: `/sources/${encodeURIComponent(document.normalization.id)}/setup`,
    }
  const setupHref = `/sources/${encodeURIComponent(setup.analysis.normalizationRevisionId)}/setup`
  const review = `${setupHref}/${encodeURIComponent(setup.id)}`
  const grant = storage.sources.getGrant(`grant-${setup.id}`)
  if (grant?.kind !== "active")
    return {
      kind: "review-required",
      actionHref: grant ? setupHref : review,
    }
  const analysis = storage.workflow.findSuccessfulAnalysis(analysisCacheKey(setup.analysis))
  const jobs = projectOwnerJobs(storage, ownerId, setup.id).jobs.filter(
    (job) =>
      job.stage === "questions" ||
      (job.stage === "analysis" && (!analysis || job.state === "historical-inert")),
  )
  const pending = jobs
    .filter((job) => job.state !== "completed")
    .sort((left, right) => {
      const stage = Number(left.stage === "questions") - Number(right.stage === "questions")
      const state = (stateOrder[left.state] ?? 6) - (stateOrder[right.state] ?? 6)
      return stage || state || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
    })
  const job = pending[0]
  if (job) {
    const stage = job.stage === "questions" ? "questions" : "analysis"
    switch (job.state) {
      case "queued":
      case "running":
      case "failed":
      case "paused":
      case "cancelled":
        return {
          kind: "progress",
          stage,
          state: job.state,
          reason: job.reason ?? job.failureCode,
          actionHref: `/jobs?setup=${encodeURIComponent(setup.id)}`,
        }
      case "historical-inert":
        return { kind: "review-required", actionHref: setupHref }
      default:
        throw new TypeError("Unexpected projected job state")
    }
  }
  return {
    kind: "progress",
    stage: analysis || jobs.some((job) => job.stage === "questions") ? "questions" : "analysis",
    state: "not-scheduled",
    reason: null,
    actionHref: `/jobs?setup=${encodeURIComponent(setup.id)}`,
  }
}

export function configureInterviewReadiness(app: Hono<AppEnvironment>, storage: Storage): void {
  app.get("/api/interview-readiness/:study", (context) => {
    context.header("Cache-Control", "private, no-store")
    return context.json(
      InterviewReadiness.parse(
        interviewReadiness(storage, context.get("ownerId"), context.req.param("study")),
      ),
    )
  })
}
