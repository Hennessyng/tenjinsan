import {
  contentDigest,
  Job,
  type Job as JobRecord,
  OutlineContent,
  RunBudget,
} from "@reading-studio/contracts"
import {
  ProviderError,
  ProviderReceipt,
  type StructuredStage,
  selectedEvidence,
} from "@reading-studio/providers"
import type { Storage } from "@reading-studio/storage"
import { lessonJobId, loadSectionDraft } from "./lesson-checkpoints.ts"
import { LessonFixtureDraft, LessonGenerationError } from "./lesson-contracts.ts"
import { validateLessonDraft } from "./lesson-validation.ts"

export { advanceLessonStage } from "./lesson-checkpoints.ts"

export function queueGenerationStage(
  storage: Storage,
  stage: "outline" | "lesson",
  inputId: string,
  setupId: string,
  grantId: string,
  requestRevisionId?: string,
): void {
  const setup = storage.sources.getSetup(setupId)
  const grant = storage.sources.getGrant(grantId)
  if (!setup || !grant || grant.kind !== "active")
    throw new TypeError("Current transmission grant required")
  const id =
    requestRevisionId && stage === "outline"
      ? `outline-${requestRevisionId}`
      : `${stage}-${contentDigest(JSON.stringify([inputId, setupId, grantId]))}`
  if (!storage.execution.getRun(id))
    storage.execution.appendRun({
      id,
      inputRevisionId: inputId,
      budget: RunBudget.parse({ maxCalls: 2 }),
      reservedCalls: 0,
      state: "running",
    })
  if (!storage.execution.getJob(id))
    storage.execution.appendJob(
      Job.parse({
        id,
        runId: id,
        inputRevisionId: inputId,
        setupRevisionId: setupId,
        provider: setup.analysis.provider,
        model: setup.analysis.model,
        promptVersion: setup.generation.promptVersion,
        schemaVersion: setup.generation.schemaVersion,
        grant,
        stage,
        checkpoint: null,
        cancellationRequested: false,
        usage: { kind: "known", inputTokens: 0, outputTokens: 0 },
        state: "queued",
      }),
    )
}

export function generationStage(storage: Storage, job: JobRecord): StructuredStage {
  const setup = storage.sources.getSetup(job.setupRevisionId)
  if (!setup || (job.stage !== "outline" && job.stage !== "lesson"))
    throw new TypeError("Unknown generation stage")
  const normalization = storage.sources.getNormalization(setup.analysis.normalizationRevisionId)
  const first = setup.analysis.scope.selected[0]
  const resource = normalization?.resources.find((entry) => entry.path === first?.resourcePath)
  const block =
    resource?.status === "included"
      ? resource.blocks.find((item) => item.id === first?.blockIds[0])
      : undefined
  if (!block) throw new TypeError("Approved source window required")
  const sourceWindow = { blockId: block.id, start: 0, end: Math.min(block.text.length, 12_000) }
  if (job.stage === "outline") {
    const brief = storage.briefs.approved(job.inputRevisionId)
    if (!brief || brief.setupRevisionId !== setup.id)
      throw new TypeError("Current approved brief required")
    const requestId = job.id.slice("outline-".length)
    const request = storage.outlines.request(requestId)
    const currentOutline = storage.outlines.current(brief.studyId)
    if (
      request &&
      (request.briefRevisionId !== brief.id ||
        (currentOutline?.draft.id !== request.id &&
          !storage.outlines.follows(currentOutline?.draft.id ?? "", request.id)))
    )
      throw new ProviderError("unauthorized")
    const analysis = storage.workflow.getAnalysis(brief.analysisRevisionId)
    if (analysis?.status !== "successful") throw new TypeError("Successful analysis required")
    const known = new Set(
      [...analysis.claims, ...analysis.concepts, ...analysis.qualifications].flatMap((finding) =>
        finding.sources.map((span) => JSON.stringify(span)),
      ),
    )
    const findings = [...analysis.claims, ...analysis.concepts, ...analysis.qualifications]
    const selected = selectedEvidence(
      storage,
      findings.flatMap((finding) => finding.sources),
    )
    const evidence = findings.map((finding) => ({
      id: finding.id,
      text: finding.text,
      sources: finding.sources.map(selected.reference),
    }))
    return {
      sourceWindow,
      schema: OutlineContent.superRefine((draft, context) => {
        if (
          JSON.stringify(draft.qualifications) !== JSON.stringify(analysis.qualifications) ||
          JSON.stringify(draft.excludedAreas) !== JSON.stringify(brief.exclusions)
        )
          context.addIssue({ code: "custom", message: "retained brief/analysis fields differ" })
        for (const section of draft.sections)
          if (
            [...section.sources, ...section.visualEvidence].some(
              (span) => !known.has(JSON.stringify(span)),
            )
          )
            context.addIssue({
              code: "custom",
              message: "outline citation outside approved evidence",
            })
      }),
      instruction: `Write a bilingual teaching outline from this approved reader brief and retrieved book evidence. Copy exact citations from the citation table into the output schema. Keep the exact qualifications and exclusions. No unsupported visual claims. ${request ? `Revision: ${JSON.stringify({ previous: request.content, feedback: request.feedback })}. ` : ""}Citations: ${JSON.stringify(selected.citations)} Passages: ${JSON.stringify(selected.passages)} Brief: ${JSON.stringify(brief)} Evidence: ${JSON.stringify(evidence)}`,
    }
  }
  const outline = storage.outlines.approved(job.inputRevisionId)
  const current = outline && storage.outlines.current(outline.studyId)
  if (
    !outline ||
    current?.status !== "approved" ||
    current.draft.id !== outline.id ||
    outline.setupRevisionId !== setup.id
  )
    throw new TypeError("Current approved outline required")
  const sectionIndex = current.draft.content.sections.findIndex(
    (_, index) => lessonJobId(outline.id, job.setupRevisionId, job.grant.id, index) === job.id,
  )
  const section = current.draft.content.sections[sectionIndex]
  if (!section) throw new ProviderError("unauthorized")
  const priorScenes = new Set(
    current.draft.content.sections.slice(0, sectionIndex).flatMap((_, index) => {
      const previous = storage.execution.getJob(
        lessonJobId(outline.id, job.setupRevisionId, job.grant.id, index),
      )
      if (!previous) throw new ProviderError("unauthorized")
      return loadSectionDraft(storage, previous).sections.flatMap((item) =>
        item.scenes.map((scene) => scene.id),
      )
    }),
  )
  const selectedSpans = [
    ...section.sources,
    ...section.visualEvidence,
    ...current.draft.content.qualifications.flatMap((finding) => finding.sources),
  ]
  const selected = selectedEvidence(storage, selectedSpans)
  const compactOutline = {
    ...current.draft.content,
    sections: [
      {
        ...section,
        sources: section.sources.map(selected.reference),
        visualEvidence: section.visualEvidence.map(selected.reference),
      },
    ],
    qualifications: current.draft.content.qualifications.map((finding) => ({
      ...finding,
      sources: finding.sources.map(selected.reference),
    })),
  }
  return {
    sourceWindow,
    schema: LessonFixtureDraft.superRefine((draft, context) => {
      try {
        validateLessonDraft(
          { ...current.draft, content: { ...current.draft.content, sections: [section] } },
          draft,
        )
        if (draft.sections.some((item) => item.scenes.some((scene) => priorScenes.has(scene.id))))
          context.addIssue({ code: "custom", message: "scene ID already used by prior section" })
      } catch (error) {
        if (error instanceof LessonGenerationError)
          context.addIssue({ code: "custom", message: error.code })
        else throw error
      }
    }),
    instruction: `Write a paired English/Japanese lesson for this one section of the exact approved outline, outlineRevisionId=${current.draft.id}. Use scene IDs unique across sections, prefixed with this section ID. Copy exact citations from the citation table into the output schema. Attribute verbatim source excerpts, retain caveats and qualifications, and label all illustrative assumptions. Citations: ${JSON.stringify(selected.citations)} Passages: ${JSON.stringify(selected.passages)} Outline: ${JSON.stringify(compactOutline)} Evidence: ${JSON.stringify(selected.citations)}`,
  }
}

export function saveGenerationStage(storage: Storage, job: JobRecord): void {
  const attempt = storage.execution.listAttempts(job.runId).at(-1)
  const body = attempt && storage.execution.getAttemptReceipt(attempt.id)
  if (!body) throw new TypeError("Missing durable stage receipt")
  const receipt = ProviderReceipt.parse(JSON.parse(new TextDecoder().decode(body)))
  if (receipt.kind !== "output") throw new TypeError("Structured stage output unavailable")
  const output: unknown = JSON.parse(receipt.text)
  if (job.stage === "outline") {
    const brief = storage.briefs.approved(job.inputRevisionId)
    if (!brief) throw new ProviderError("unauthorized")
    const request = storage.outlines.request(job.id.slice("outline-".length))
    if (request) {
      const current = storage.outlines.current(brief.studyId)
      if (current && storage.outlines.follows(current.draft.id, request.id)) return
      if (current?.draft.id !== request.id) throw new ProviderError("unauthorized")
      storage.outlines.save({
        studyId: brief.studyId,
        briefRevisionId: brief.id,
        expectedRevisionId: request.id,
        content: OutlineContent.parse(output),
        feedback: request.feedback,
      })
      return
    }
    if (storage.outlines.current(brief.studyId)?.draft.briefRevisionId === brief.id) return
    storage.outlines.save({
      studyId: brief.studyId,
      briefRevisionId: brief.id,
      expectedRevisionId: storage.outlines.current(brief.studyId)?.draft.id ?? null,
      content: OutlineContent.parse(output),
      feedback: null,
    })
  } else if (job.stage === "lesson") {
    const outline = storage.outlines.approved(job.inputRevisionId)
    if (!outline) throw new ProviderError("unauthorized")
    if (job.state !== "running") throw new ProviderError("unauthorized")
    const draft = LessonFixtureDraft.parse(output)
    storage.execution.saveCheckpoint({
      jobId: job.id,
      token: job.lease.token,
      fence: job.lease.fence,
      now: new Date().toISOString(),
      checkpoint: contentDigest(JSON.stringify(draft)),
    })
  }
}
