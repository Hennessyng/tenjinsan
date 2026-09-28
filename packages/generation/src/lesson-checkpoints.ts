import { contentDigest, Job, type Job as JobRecord, RunBudget } from "@reading-studio/contracts"
import { ProviderError, ProviderReceipt } from "@reading-studio/providers"
import type { Storage } from "@reading-studio/storage"
import { materializeLesson } from "./lesson.ts"
import { LessonFixtureDraft } from "./lesson-contracts.ts"

export function lessonJobId(
  outlineId: string,
  setupId: string,
  grantId: string,
  index: number,
): string {
  const base = `lesson-${contentDigest(JSON.stringify([outlineId, setupId, grantId]))}`
  return index === 0 ? base : `${base}-${String(index).padStart(2, "0")}`
}

export function loadSectionDraft(storage: Storage, entry: JobRecord): LessonFixtureDraft {
  if (entry.state !== "completed" || !entry.checkpoint || entry.resultHash !== entry.checkpoint)
    throw new ProviderError("unauthorized")
  const attempt = storage.execution.listAttempts(entry.runId).at(-1)
  const body = attempt && storage.execution.getAttemptReceipt(attempt.id)
  if (!body) throw new ProviderError("unauthorized")
  const receipt = ProviderReceipt.parse(JSON.parse(new TextDecoder().decode(body)))
  if (receipt.kind !== "output") throw new ProviderError("unauthorized")
  const draft = LessonFixtureDraft.parse(JSON.parse(receipt.text))
  if (contentDigest(JSON.stringify(draft)) !== entry.checkpoint || draft.sections.length !== 1)
    throw new ProviderError("unauthorized")
  return draft
}

export function advanceLessonStage(storage: Storage, job: JobRecord): void {
  if (job.stage !== "lesson" || job.state !== "completed") return
  const outline = storage.outlines.approved(job.inputRevisionId)
  const current = outline && storage.outlines.current(outline.studyId)
  if (!outline || current?.status !== "approved" || current.draft.id !== outline.id)
    throw new ProviderError("unauthorized")
  const lessonId = `lesson-${lessonJobId(outline.id, job.setupRevisionId, job.grant.id, 0)}`
  if (storage.workflow.getLesson(lessonId)) return
  const jobs = current.draft.content.sections.map((_, index) =>
    storage.execution.getJob(lessonJobId(outline.id, job.setupRevisionId, job.grant.id, index)),
  )
  const next = jobs.findIndex((entry) => entry?.state !== "completed")
  if (next >= 0) {
    if (next > 0 && jobs[next - 1]?.state === "completed") {
      const id = lessonJobId(outline.id, job.setupRevisionId, job.grant.id, next)
      if (!storage.execution.getRun(id))
        storage.execution.appendRun({
          id,
          inputRevisionId: outline.id,
          budget: RunBudget.parse({ maxCalls: 2 }),
          reservedCalls: 0,
          state: "running",
        })
      if (!storage.execution.getJob(id))
        storage.execution.appendJob(
          Job.parse({
            id,
            runId: id,
            inputRevisionId: job.inputRevisionId,
            setupRevisionId: job.setupRevisionId,
            provider: job.provider,
            model: job.model,
            promptVersion: job.promptVersion,
            schemaVersion: job.schemaVersion,
            grant: job.grant,
            stage: "lesson",
            checkpoint: null,
            cancellationRequested: false,
            usage: { kind: "known", inputTokens: 0, outputTokens: 0 },
            state: "queued",
          }),
        )
    }
    return
  }
  const drafts = jobs.map((entry) => {
    if (!entry) throw new ProviderError("unauthorized")
    return loadSectionDraft(storage, entry)
  })
  materializeLesson(
    storage,
    { studyId: outline.studyId, outlineRevisionId: outline.id, lessonRevisionId: lessonId },
    { outlineRevisionId: outline.id, sections: drafts.flatMap((draft) => draft.sections) },
  )
}
