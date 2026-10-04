import {
  AnalysisRevision,
  analysisCacheKey,
  contentDigest,
  Job,
  RunBudget,
} from "@reading-studio/contracts"
import {
  authorizeSource,
  type ProviderAuthority,
  ProviderError,
  ProviderReceipt,
  type StructuredStage,
} from "@reading-studio/providers"
import {
  BlockAnalysis,
  type BookMapDefinition,
  BookMapError,
  bookMapDefinition,
  linkedFindings,
  type SourceWindow,
} from "./book-map-output.ts"

export { type BookMapDefinition, bookMapDefinition } from "./book-map-output.ts"

const WINDOW_CHARACTERS = 12000
const MAX_WINDOWS = 128

export class BookMapPipeline {
  constructor(
    private readonly authority: ProviderAuthority,
    private readonly definition: BookMapDefinition = bookMapDefinition,
  ) {}

  private context(setupId: string, grantId: string) {
    const { sources } = this.authority.storage
    const setup = sources.getSetup(setupId)
    const grant = sources.getGrant(grantId)
    if (!setup || !grant) throw new ProviderError("unauthorized")
    const key = analysisCacheKey(setup.analysis)
    const identity = contentDigest(JSON.stringify([setup.id, grant.id, key]))
    const template = Job.parse({
      id: identity,
      runId: identity,
      inputRevisionId: identity,
      setupRevisionId: setup.id,
      provider: setup.analysis.provider,
      model: setup.analysis.model,
      promptVersion: setup.analysis.analysisPromptVersion,
      schemaVersion: setup.analysis.analysisSchemaVersion,
      grant,
      stage: "analysis",
      checkpoint: null,
      cancellationRequested: false,
      usage: { kind: "known", inputTokens: 0, outputTokens: 0 },
      state: "queued",
    })
    const { blocks } = authorizeSource(this.authority, template)
    if (
      template.promptVersion !== this.definition.promptVersion ||
      template.schemaVersion !== this.definition.schemaVersion
    )
      throw new BookMapError("unsupported-version")
    const normalization = sources.getNormalization(setup.analysis.normalizationRevisionId)
    if (!normalization) throw new ProviderError("unauthorized")
    const windows: SourceWindow[] = []
    for (const block of blocks) {
      if (block.text.length === 0) throw new BookMapError("scope-limit")
      const resource = normalization.resources.find((entry) => entry.path === block.resourcePath)
      const source =
        resource?.status === "included"
          ? resource.blocks.find((entry) => entry.id === block.blockId)
          : undefined
      if (!source) throw new ProviderError("unauthorized")
      for (let start = 0; start < block.text.length; start += WINDOW_CHARACTERS) {
        windows.push({
          resourcePath: block.resourcePath,
          blockId: block.blockId,
          start,
          end: Math.min(start + WINDOW_CHARACTERS, block.text.length),
          text: block.text.slice(start, start + WINDOW_CHARACTERS),
          ...(source.pageLabel ? { pageLabel: source.pageLabel } : {}),
        })
        if (windows.length > MAX_WINDOWS) throw new BookMapError("scope-limit")
      }
    }
    if (windows.length === 0) throw new BookMapError("scope-limit")
    return { setup, key, identity, template, windows }
  }

  prepare(setupId: string, grantId: string): AnalysisRevision {
    const context = this.context(setupId, grantId)
    const { workflow, execution } = this.authority.storage
    const cached = workflow.findSuccessfulAnalysis(context.key)
    if (cached) return cached
    const inputRevisionId = workflow.ensureAnalysisInput(setupId)
    const base = AnalysisRevision.parse({
      id: `map-${context.key}`,
      editionId: context.setup.editionId,
      cacheInput: context.setup.analysis,
      cacheKey: context.key,
      status: "partial",
      chapters: context.setup.analysis.scope.selected.map((resource) => ({
        ...resource,
        status: "pending",
      })),
      claims: [],
      concepts: [],
      qualifications: [],
    })
    const completed = new Set<number>()
    const findings = {
      claims: [...base.claims],
      concepts: [...base.concepts],
      qualifications: [...base.qualifications],
    }
    for (const [index, window] of context.windows.entries()) {
      const id = `${context.identity}-${index}`
      if (!execution.getRun(id))
        execution.appendRun({
          id,
          inputRevisionId,
          budget: RunBudget.parse({ maxCalls: 2, maxSourceCharacters: WINDOW_CHARACTERS }),
          reservedCalls: 0,
          state: "running",
        })
      const job =
        execution.getJob(id) ??
        execution.appendJob({ ...context.template, id, runId: id, inputRevisionId })
      if (job.state !== "completed") continue
      const attempt = execution.listAttempts(job.runId).at(-1)
      const body = attempt ? execution.getAttemptReceipt(attempt.id) : null
      if (!body) throw new BookMapError("missing-receipt")
      const receipt = ProviderReceipt.parse(JSON.parse(new TextDecoder().decode(body)))
      if (receipt.kind !== "output") throw new BookMapError("missing-receipt")
      const output: unknown = JSON.parse(receipt.text)
      const parsed = BlockAnalysis.parse(output)
      if (contentDigest(JSON.stringify(parsed)) !== job.resultHash)
        throw new BookMapError("missing-receipt")
      const linked = linkedFindings({
        output: parsed,
        window,
        map: base,
        prefix: `${context.key}-${index}`,
      })
      findings.claims.push(...linked.claims)
      findings.concepts.push(...linked.concepts)
      findings.qualifications.push(...linked.qualifications)
      completed.add(index)
    }
    // Deterministic, lossless synthesis preserves qualifications rather than asking
    // another provider call to compress away a counterweight or approved chapter.
    const record = AnalysisRevision.parse({
      ...base,
      ...findings,
      id: `map-${contentDigest(JSON.stringify([context.key, [...completed], findings]))}`,
      status: completed.size === context.windows.length ? "successful" : "partial",
      chapters: base.chapters.map((chapter) => ({
        ...chapter,
        status: context.windows.every(
          (window, index) => window.resourcePath !== chapter.resourcePath || completed.has(index),
        )
          ? "complete"
          : "pending",
      })),
    })
    return (
      workflow.getAnalysis(record.id) ?? workflow.appendAnalysis({ record, parentRevisionId: null })
    )
  }

  stage(job: Job): StructuredStage {
    const context = this.context(job.setupRevisionId, job.grant.id)
    const index = context.windows.findIndex((_, index) => `${context.identity}-${index}` === job.id)
    const window = context.windows[index]
    if (
      !window ||
      job.provider !== context.template.provider ||
      job.model !== context.template.model ||
      job.promptVersion !== context.template.promptVersion ||
      job.schemaVersion !== context.template.schemaVersion ||
      job.stage !== "analysis"
    )
      throw new BookMapError("foreign-job")
    return {
      schema: BlockAnalysis.superRefine((output, ctx) => {
        for (const finding of [...output.claims, ...output.concepts, ...output.qualifications]) {
          if (
            finding.start < window.start ||
            finding.end > window.end ||
            finding.end <= finding.start
          )
            ctx.addIssue({ code: "custom", message: "citation outside dispatched source window" })
        }
      }),
      sourceWindow: window,
      instruction: this.definition.instruction,
    }
  }
}
