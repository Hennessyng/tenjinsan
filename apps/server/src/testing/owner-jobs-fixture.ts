import { defaultSettings } from "@reading-studio/providers"
import { sourceViewerFixture } from "./source-viewer-fixture.ts"

export async function ownerJobsFixture(provider: "openrouter" | "openai" = "openrouter") {
  const fixture = await sourceViewerFixture()
  const storage = fixture.storage
  const owner = storage.sources.listStudiesByEdition("edition-fixture")[0]
  if (!owner) throw new TypeError("Fixture study missing")
  const installationId = storage.sources.createInstallation({
    id: "installation-jobs",
    ownerId: owner.ownerId,
  })
  storage.sources.appendSetup({
    parentRevisionId: null,
    record: {
      id: "setup-jobs",
      studyId: owner.id,
      editionId: owner.editionId,
      analysis: {
        editionHash: "a".repeat(64),
        normalizationRevisionId: "revision-fixture",
        scope: {
          kind: "partial",
          selected: [{ resourcePath: "chapter-one.xhtml", blockIds: ["opening"] }],
          exclusions: [],
        },
        provider,
        model: "gpt-4.1-mini",
        analysisPromptVersion: "analysis-1",
        analysisSchemaVersion: "analysis-1",
        settings: defaultSettings,
      },
      generation: {
        promptVersion: "generation-1",
        schemaVersion: "generation-1",
        settings: defaultSettings,
      },
    },
  })
  const grant = storage.sources.appendGrant({
    id: "grant-setup-jobs",
    kind: "active",
    setupRevisionId: "setup-jobs",
    installationId,
    ownerId: owner.ownerId,
    categories: ["book-text"],
    approvedAt: new Date().toISOString(),
  })
  const inputRevisionId = storage.workflow.ensureAnalysisInput("setup-jobs")
  storage.execution.appendRun({
    id: "run-jobs",
    inputRevisionId,
    budget: {
      maxCalls: 2,
      maxSourceCharacters: 32000,
      maxOutputTokens: 6000,
      maxTransientRetries: 2,
      maxSchemaRepairs: 1,
    },
    reservedCalls: 0,
    state: "running",
  })
  storage.execution.appendJob({
    id: "job-jobs",
    runId: "run-jobs",
    inputRevisionId,
    setupRevisionId: "setup-jobs",
    provider,
    model: "gpt-4.1-mini",
    promptVersion: "analysis-1",
    schemaVersion: "analysis-1",
    grant,
    stage: "analysis",
    checkpoint: null,
    cancellationRequested: false,
    usage: { kind: "known", inputTokens: 0, outputTokens: 0 },
    state: "queued",
  })
  const login = await fetch(`${fixture.origin}/login`, {
    method: "POST",
    redirect: "manual",
    headers: { origin: fixture.origin, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fixture.credentials),
  })
  const cookie = login.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ")
  return { fixture, cookie }
}
