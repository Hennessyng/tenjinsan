import {
  analysisCacheKey,
  ContentId,
  chapterFindings,
  contentDigest,
  Job,
  type Job as JobRecord,
  RunBudget,
  synthesisFindings,
} from "@reading-studio/contracts"
import {
  type ProviderAuthority,
  ProviderError,
  ProviderReceipt,
  requireInferenceReview,
  type StructuredStage,
} from "@reading-studio/providers"
import type { Storage } from "@reading-studio/storage"
import { originalContext } from "./original-context.ts"
import { WholeBookContext } from "./whole-book-context.ts"
import { VerificationOutput, wholeBookInstructions } from "./whole-book-output.ts"

function checkInput(storage: Storage, source: JobRecord) {
  const setup = storage.sources.getSetup(source.setupRevisionId)
  const grant = storage.sources.getGrant(source.grant.id)
  if (
    !setup ||
    grant?.kind !== "active" ||
    source.cancellationRequested ||
    grant.setupRevisionId !== setup.id ||
    storage.sources.getLatestSetup(setup.studyId)?.id !== setup.id ||
    source.provider !== setup.analysis.provider ||
    source.model !== setup.analysis.model ||
    source.promptVersion !== setup.generation.promptVersion ||
    source.schemaVersion !== setup.generation.schemaVersion ||
    !grant.categories.includes("derived-study-material") ||
    !grant.categories.includes("book-text")
  )
    throw new ProviderError("unauthorized")
  const analysis = storage.workflow.findSuccessfulAnalysis(analysisCacheKey(setup.analysis), {
    setupId: setup.id,
    grantId: source.grant.id,
  })
  if (!analysis?.wholeBook?.synthesis || analysis.wholeBook.phase !== "complete")
    throw new ProviderError("analysis-incomplete")
  const attempt = storage.execution.listAttempts(source.runId).at(-1)
  const body = attempt && storage.execution.getAttemptReceipt(attempt.id)
  if (!body) throw new ProviderError("analysis-incomplete")
  const receipt = ProviderReceipt.parse(JSON.parse(new TextDecoder().decode(body)))
  if (receipt.kind !== "output") throw new ProviderError("analysis-incomplete")
  const hash = contentDigest(receipt.text)
  const id = `check-${contentDigest(JSON.stringify([source.id, hash]))}`
  const findings = [
    ...analysis.wholeBook.maps.flatMap(chapterFindings),
    ...synthesisFindings(analysis.wholeBook.synthesis),
  ]
  const sources = [
    ...new Map(
      findings.flatMap((finding) => finding.sources).map((span) => [JSON.stringify(span), span]),
    ).values(),
  ]
  const interpretation = {
    id: ContentId.parse(`interpretation-${contentDigest(JSON.stringify([source.id, hash]))}`),
    text: receipt.text,
    sources,
  }
  return { setup, grant, analysis, id, interpretation, findings }
}

export function interpretationVerified(storage: Storage, source: JobRecord): boolean {
  const setup = storage.sources.getSetup(source.setupRevisionId)
  if (!setup) throw new ProviderError("unauthorized")
  requireInferenceReview(setup)
  const input = checkInput(storage, source)
  let check = storage.execution.getJob(input.id)
  if (!check) {
    const used = new Set(
      storage.execution
        .listSetupJobs(setup.id)
        .flatMap((job) => storage.execution.listAttempts(job.runId).map((attempt) => attempt.id)),
    ).size
    if (used + 2 > Math.min(64, storage.liveStudyGuard.limit(setup.id)))
      throw new ProviderError("attempt-budget-limit")
    if (!storage.execution.getRun(input.id))
      storage.execution.appendRun({
        id: input.id,
        inputRevisionId: source.inputRevisionId,
        budget: RunBudget.parse({ maxCalls: 2 }),
        reservedCalls: 0,
        state: "running",
      })
    check = storage.execution.appendJob(
      Job.parse({
        id: input.id,
        runId: input.id,
        inputRevisionId: source.inputRevisionId,
        setupRevisionId: setup.id,
        provider: source.provider,
        model: source.model,
        grant: input.grant,
        stage: "analysis",
        promptVersion: setup.analysis.analysisPromptVersion,
        schemaVersion: setup.analysis.analysisSchemaVersion,
        checkpoint: null,
        state: "queued",
        cancellationRequested: false,
        usage: { kind: "known", inputTokens: 0, outputTokens: 0 },
      }),
    )
  }
  if (check.state !== "completed") return false
  const attempt = storage.execution.listAttempts(check.runId).at(-1)
  const body = attempt && storage.execution.getAttemptReceipt(attempt.id)
  if (!body) throw new ProviderError("analysis-incomplete")
  const receipt = ProviderReceipt.parse(JSON.parse(new TextDecoder().decode(body)))
  if (receipt.kind !== "output") throw new ProviderError("analysis-incomplete")
  const output = VerificationOutput.parse(JSON.parse(receipt.text))
  const verified =
    output.decisions.length === 1 &&
    output.decisions[0]?.id === input.interpretation.id &&
    output.decisions[0]?.verdict === "supported" &&
    contentDigest(JSON.stringify(output)) === check.resultHash
  if (!verified)
    storage.setupScheduling.record({ grantId: input.grant.id, failure: "analysis-incomplete" })
  return verified
}

export function interpretationCheckStage(
  authority: ProviderAuthority,
  check: JobRecord,
): StructuredStage {
  const context = new WholeBookContext(authority, check.setupRevisionId, check.grant.id)
  if (
    check.cancellationRequested ||
    check.stage !== "analysis" ||
    check.promptVersion !== context.template.promptVersion ||
    check.schemaVersion !== context.template.schemaVersion ||
    check.provider !== context.template.provider ||
    check.model !== context.template.model
  )
    throw new ProviderError("unauthorized")
  for (const source of authority.storage.execution.listSetupJobs(check.setupRevisionId)) {
    if (
      !(source.stage === "questions" || source.stage === "outline" || source.stage === "lesson") ||
      source.state !== "completed" ||
      source.grant.id !== check.grant.id
    )
      continue
    const input = checkInput(authority.storage, source)
    if (input.id !== check.id) continue
    const binding = contentDigest(
      JSON.stringify([
        "question-evidence-refs-v1",
        input.setup,
        input.analysis,
        context.normalization,
        source.inputRevisionId,
      ]),
    )
    const citations = input.interpretation.sources.map((span) => ({
      id: `evidence-${contentDigest(JSON.stringify([binding, span]))}`,
      span,
    }))
    return {
      processingStep: "original-verification",
      schema: VerificationOutput.superRefine((output, ctx) => {
        if (output.decisions.length !== 1 || output.decisions[0]?.id !== input.interpretation.id)
          ctx.addIssue({ code: "custom", message: "missing exact draft verdict" })
      }),
      sourceRanges: originalContext(context, input.findings),
      derivedData: [
        {
          kind: "original-verification",
          interpretations: [input.interpretation],
          citations,
          qualifications: input.analysis.qualifications,
          artifactKind: source.stage,
        },
      ],
      instruction: `${wholeBookInstructions.verify} Review the entire proposed artifact, including each claim, rationale, question premise, caveat and both English/Japanese versions. A single unsupported statement or lost qualification prevents a supported verdict. Questions expressing reader interests are not assertions of book facts. Illustrative models must remain labeled as such. Evidence references are resolved by the supplied citation table, never by path access.`,
      capacity: context.capacity,
    }
  }
  throw new ProviderError("unauthorized")
}
