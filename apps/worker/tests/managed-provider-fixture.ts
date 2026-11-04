import { randomUUID } from "node:crypto"
import { Job, type NormalizationRevision } from "@reading-studio/contracts"
import { LocalSubscriptionAdapter, ProviderRunner } from "@reading-studio/providers"
import { z } from "zod"
import { WorkerRuntime } from "../src/runtime.ts"
import { managedWorkflowFixture } from "./managed-workflow-fixture.ts"

export const providerStage = {
  schema: z.strictObject({ answer: z.string() }),
  instruction: "Return a synthetic answer from the supplied source",
}

export async function managedProviderFixture(
  budget: { readonly maxCalls?: number; readonly maxSchemaRepairs?: number } = {},
  document?: NormalizationRevision,
) {
  const flow = await managedWorkflowFixture(document ? { document } : {})
  const { storage } = flow
  const template = storage.execution.listSetupJobs(flow.setupId)[0]
  const run = template && storage.execution.getRun(template.runId)
  if (!template || !run) throw new TypeError("Missing managed analysis fixture")
  for (const job of storage.execution.listSetupJobs(flow.setupId))
    storage.execution.requestCancellation({ jobId: job.id })
  storage.execution.appendRun({
    ...run,
    id: "provider-run",
    budget: { ...run.budget, maxCalls: 3, maxSchemaRepairs: 1, ...budget },
  })
  const queued = storage.execution.appendJob(
    Job.parse({ ...template, id: "provider-job", runId: "provider-run" }),
  )
  const authority = flow.authority()
  const adapter = new LocalSubscriptionAdapter(authority, queued)
  const runner = new ProviderRunner({
    ...authority,
    adapters: { "chatgpt-subscription": adapter },
  })
  return {
    close: flow.close,
    respond: flow.respond,
    requests: flow.requests,
    network: flow.network,
    login: flow.login,
    storage,
    authority,
    adapter,
    runner,
    queued,
    claim() {
      const job = storage.execution.claimNextJob({
        token: randomUUID(),
        now: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 120000).toISOString(),
      })
      if (job?.state !== "running" || job.id !== queued.id)
        throw new TypeError("Expected managed provider claim")
      return job
    },
    worker: new WorkerRuntime({
      storage,
      clock: authority.clock,
      leaseDurationMs: 120000,
      tokenFactory: randomUUID,
      attemptIdFactory: () => randomUUID(),
      resolveStage: () => ({ kind: "structured", runner, request: providerStage }),
    }),
  }
}
