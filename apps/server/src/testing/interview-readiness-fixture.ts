import { analysisCacheKey, type Job, type StudySetupRevision } from "@reading-studio/contracts"
import { z } from "zod"
import { uploadHarness } from "./upload-harness.ts"

type JobVariant =
  | { readonly state: "queued" | "cancelled" }
  | { readonly state: "running"; readonly lease: Extract<Job, { state: "running" }>["lease"] }
  | { readonly state: "failed"; readonly error: Extract<Job, { state: "failed" }>["error"] }
  | { readonly state: "paused"; readonly reason: Extract<Job, { state: "paused" }>["reason"] }
  | {
      readonly state: "completed"
      readonly resultHash: Extract<Job, { state: "completed" }>["resultHash"]
    }

export async function readinessFixture() {
  const harness = await uploadHarness({ providerAvailable: true })
  const uploaded = await fetch(`${harness.origin}/api/imports/upload`, {
    method: "POST",
    headers: { origin: harness.origin, "content-type": "text/plain" },
    body: "A synthetic book about asking careful questions.",
  })
  if (uploaded.status !== 202) throw new TypeError("Fixture import failed")
  const { normalizationRevisionId: revision } = z
    .object({ normalizationRevisionId: z.string() })
    .parse(await uploaded.json())
  const storage = harness.sourceStorage
  const normalization = storage.sources.getNormalization(revision)
  if (!normalization) throw new TypeError("Missing imported normalization")
  const study = storage.sources.listStudiesByEdition(normalization.editionId)[0]
  if (!study) throw new TypeError("Missing imported study")
  const headers = { origin: harness.origin, "content-type": "application/json" }
  const draft = async () => {
    const response = await fetch(`${harness.origin}/api/study-setup/${revision}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ provider: "anthropic", scope: "whole-document" }),
    })
    if (response.status !== 201) throw new TypeError("Fixture draft failed")
    return z.object({ setupId: z.string() }).parse(await response.json()).setupId
  }
  const decide = (setupId: string, decision: "send" | "cancel" | "revise" = "send") =>
    fetch(`${harness.origin}/api/study-setup/${revision}/${setupId}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ decision }),
    })
  function seedJob(
    setupId: string,
    id: string,
    input: { readonly stage: "analysis" | "questions" } & JobVariant,
  ) {
    const setup = storage.sources.getSetup(setupId)
    const grant = storage.sources.getGrant(`grant-${setupId}`)
    if (!setup || !grant) throw new TypeError("Fixture setup/grant missing")
    const inputRevisionId = storage.workflow.ensureAnalysisInput(setupId)
    storage.execution.appendRun({
      id: `run-${id}`,
      inputRevisionId,
      budget: { maxCalls: 2 },
      reservedCalls: 0,
      state: "running",
    })
    return storage.execution.appendJob({
      id,
      runId: `run-${id}`,
      inputRevisionId,
      setupRevisionId: setupId,
      provider: setup.analysis.provider,
      model: setup.analysis.model,
      promptVersion: "generation-1",
      schemaVersion: "generation-1",
      grant,
      checkpoint: null,
      cancellationRequested: false,
      usage: { kind: "known", inputTokens: 0, outputTokens: 0 },
      ...input,
    })
  }
  function completeAnalysis(setup: StudySetupRevision) {
    return storage.workflow.appendAnalysis({
      parentRevisionId: null,
      record: {
        id: `analysis-${setup.id}`,
        editionId: setup.editionId,
        cacheInput: setup.analysis,
        cacheKey: analysisCacheKey(setup.analysis),
        status: "successful",
        chapters: setup.analysis.scope.selected.map((selection) => ({
          ...selection,
          status: "complete",
        })),
        claims: [],
        concepts: [],
        qualifications: [],
      },
    })
  }
  return {
    ...harness,
    storage,
    revision,
    study,
    draft,
    decide,
    seedJob,
    completeAnalysis,
    status: () => fetch(`${harness.origin}/api/interview-readiness/${study.id}`),
  }
}
