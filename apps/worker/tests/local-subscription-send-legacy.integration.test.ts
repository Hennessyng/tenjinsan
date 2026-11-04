import { Job } from "@reading-studio/contracts"
import { completeGraphFixtures } from "@reading-studio/storage/test-support"
import { afterEach, expect, it, vi } from "vitest"
import { type ManagedWorkflow, managedWorkflowFixture } from "./managed-workflow-fixture.ts"

const resources: ManagedWorkflow[] = []
afterEach(async () => {
  for (const flow of resources.splice(0)) await flow.close()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})
const originalSendScenarios = [
  "success",
  "malformed",
  "incomplete",
  "revoked",
  "revoked-inflight",
  "fallback",
  "custom-config",
  "no-stage",
] as const
it.each(
  (["grok-subscription", "claude-subscription"] as const).flatMap((provider) =>
    originalSendScenarios.map((scenario) => ({ provider, scenario })),
  ),
)(
  "refuses legacy $provider/$scenario explicitly before executing that scenario",
  async ({ provider }) => {
    const flow = await managedWorkflowFixture({ allowSendRefusal: true })
    resources.push(flow)
    flow.session.refresh.mockClear()
    const legacyRefresh = vi
      .spyOn(flow.storage.grokSubscriptionLogin, "refresh")
      .mockRejectedValue(new TypeError("Legacy refresh forbidden"))
    const legacySession = vi
      .spyOn(flow.storage.grokSubscriptionLogin, "withSession")
      .mockRejectedValue(new TypeError("Legacy session forbidden"))
    const post = (path: string, body: unknown) =>
      flow.app.request(`http://127.0.0.1:8787${path}`, {
        method: "POST",
        headers: { origin: "http://127.0.0.1:8787", "content-type": "application/json" },
        body: JSON.stringify(body),
      })
    const before = flow.storage.counts()
    const draft = await post(`/api/study-setup/${flow.normalizationId}`, {
      provider,
      model: "study-model",
    })
    expect(draft.status).toBe(409)
    expect(await draft.json()).toMatchObject({
      error: "subscription-unverified",
      transmission: "not-sent",
    })
    expect(flow.storage.counts()).toEqual(before)
    const { storage } = flow
    const template = storage.execution.listSetupJobs(flow.setupId)[0]
    const run = template && storage.execution.getRun(template.runId)
    if (!template || !run) throw new TypeError("Missing managed fixture job")
    storage.execution.requestCancellation({ jobId: template.id })
    const legacy = completeGraphFixtures()
    const destination = {
      provider,
      accountId: "fixture-account",
      workspaceId: null,
      installationId: flow.authority().installationId,
      connectionRevision: 0,
      billingRoute: "subscription-allowance",
    }
    const setup = storage.sources.appendSetup({
      record: {
        ...legacy.setup,
        id: "legacy-setup",
        studyId: flow.studyId,
        analysis: { ...legacy.setup.analysis, provider, destination },
      },
      parentRevisionId: flow.setupId,
    })
    const grant = storage.sources.appendGrant({
      ...legacy.grant,
      id: "legacy-grant",
      setupRevisionId: setup.id,
      ownerId: flow.authority().ownerId,
      installationId: destination.installationId,
      destination,
    })
    const inputRevisionId = storage.workflow.ensureAnalysisInput(setup.id)
    storage.execution.appendRun({ ...run, id: "legacy-run", inputRevisionId })
    const job = storage.execution.appendJob(
      Job.parse({
        ...template,
        id: "legacy-job",
        runId: "legacy-run",
        inputRevisionId,
        setupRevisionId: setup.id,
        provider,
        model: setup.analysis.model,
        promptVersion: setup.analysis.analysisPromptVersion,
        schemaVersion: setup.analysis.analysisSchemaVersion,
        grant,
      }),
    )
    const saved = await post(`/api/study-setup/${flow.normalizationId}/${setup.id}`, {
      decision: "send",
    })
    expect(saved.status).toBe(409)
    expect(await saved.json()).toMatchObject({
      error: "route-re-review-required",
      transmission: "not-sent",
      reviewUrl: expect.any(String),
    })
    expect(await flow.invoke()).toMatchObject({
      kind: "provider",
      job: { state: "failed", error: { code: "route-re-review-required", retryable: false } },
    })
    expect(storage.execution.listAttempts(job.runId)).toEqual([])
    expect(storage.execution.getRun(job.runId)?.reservedCalls).toBe(0)
    expect(storage.sources.getSetup(setup.id)).toEqual(setup)
    expect(storage.sources.getGrant(grant.id)).toEqual(grant)
    expect(await flow.requests()).toHaveLength(0)
    expect(flow.session.refresh).not.toHaveBeenCalled()
    expect(flow.session.session).not.toHaveBeenCalled()
    expect(legacyRefresh).not.toHaveBeenCalled()
    expect(legacySession).not.toHaveBeenCalled()
    expect(flow.login).not.toHaveBeenCalled()
    expect(flow.network).not.toHaveBeenCalled()
  },
)
