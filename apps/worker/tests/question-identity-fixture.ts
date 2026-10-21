import { randomUUID } from "node:crypto"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { contentDigest } from "@reading-studio/contracts"
import { generateQuestions } from "@reading-studio/generation/questions"
import { queueQuestions } from "@reading-studio/generation/queue-questions"
import { ProviderRunner } from "@reading-studio/providers"
import { openStorage } from "@reading-studio/storage"
import { completeGraphFixtures } from "@reading-studio/storage/test-support"
import { vi } from "vitest"
import { questionsStage, saveQuestions } from "../src/production-questions.ts"
import { WorkerRuntime } from "../src/runtime.ts"
import { questionIdentityScope } from "./question-identity-scope.ts"

export function questionIdentityFixture() {
  const directory = mkdtempSync(join(tmpdir(), "question-identity-"))
  const storage = openStorage({
    databasePath: join(directory, "studio.sqlite"),
    privateDataRoot: join(directory, "private"),
  })
  const graph = completeGraphFixtures("openrouter")
  storage.sources.createOwner("owner-1")
  storage.sources.createInstallation({ id: "installation-1", ownerId: "owner-1" })
  storage.sources.persistDocument({ edition: graph.edition, normalization: graph.normalization })
  const scope = (name: string, shared = false) =>
    questionIdentityScope({ storage, graph, name, shared })
  type Scope = ReturnType<typeof scope>
  function capture(
    current: Scope,
    output: unknown = current.draft,
    options: { readonly clock?: () => Date; readonly alternate?: string } = {},
  ) {
    const now = (options.clock ?? (() => new Date()))().toISOString()
    queueQuestions(storage, current.setup.id, current.grant.id, current.analysis)
    const original = storage.execution
      .listSetupJobs(current.setup.id)
      .find((job) => job.stage === "questions")
    if (!original) throw new TypeError("Synthetic job missing")
    if (options.alternate) {
      storage.execution.appendRun({
        id: options.alternate,
        inputRevisionId: original.inputRevisionId,
        budget: { maxCalls: 2 },
        reservedCalls: 0,
        state: "running",
      })
      storage.execution.appendJob({
        id: options.alternate,
        runId: options.alternate,
        inputRevisionId: original.inputRevisionId,
        setupRevisionId: original.setupRevisionId,
        provider: original.provider,
        model: original.model,
        promptVersion: original.promptVersion,
        schemaVersion: original.schemaVersion,
        grant: original.grant,
        stage: "questions",
        checkpoint: null,
        cancellationRequested: false,
        usage: { kind: "known", inputTokens: 0, outputTokens: 0 },
        state: "queued",
      })
    }
    const job = storage.execution.claimNextJob({
      token: randomUUID(),
      now,
      expiresAt: new Date(Date.parse(now) + 120000).toISOString(),
    })
    if (job?.state !== "running") throw new TypeError("Synthetic claim missing")
    const lease = { jobId: job.id, token: job.lease.token, fence: job.lease.fence, now }
    const attempt = storage.execution.reserveAttempt({
      ...lease,
      attemptId: randomUUID(),
      preparedAt: now,
    })
    if (attempt.kind !== "prepared") throw new TypeError("Synthetic reservation missing")
    storage.execution.markAttemptDispatching({
      ...lease,
      attemptId: attempt.attempt.id,
      dispatchedAt: now,
    })
    storage.execution.recordAttemptReceipt({
      ...lease,
      attemptId: attempt.attempt.id,
      receivedAt: now,
      responseBody: new TextEncoder().encode(
        JSON.stringify({
          kind: "output",
          text: JSON.stringify(output),
          usage: { kind: "known", inputTokens: 10, outputTokens: 10 },
        }),
      ),
      usage: { kind: "known", inputTokens: 10, outputTokens: 10 },
    })
    return { job, lease }
  }
  function legacy(current: Scope) {
    const bank = generateQuestions(current.input, current.draft)
    for (const lens of bank.lenses)
      storage.workflow.appendQuestion({ record: lens.question, parentRevisionId: null })
    return storage.interviews.create({
      id: `legacy-${current.setup.id}`,
      studyId: current.setup.studyId,
      analysisRevisionId: current.analysis.id,
      contextRevisionId: current.input.context.revisionId,
      groups: bank.groups,
      shortlist: bank.shortlist,
      steps: bank.lenses.map((lens) => ({
        groupId: lens.groupId,
        purpose: "preference",
        question: lens.question,
      })),
    })
  }
  const dispatch = vi.fn(async () => {
    throw new TypeError("Provider dispatch forbidden")
  })
  function local(current: Scope) {
    storage.execution.appendRun({
      id: "local-other",
      inputRevisionId: current.input.context.revisionId,
      budget: { maxCalls: 2 },
      reservedCalls: 0,
      state: "running",
    })
    storage.execution.appendJob({
      id: "local-other",
      runId: "local-other",
      inputRevisionId: current.input.context.revisionId,
      setupRevisionId: current.setup.id,
      provider: current.setup.analysis.provider,
      model: current.setup.analysis.model,
      promptVersion: current.setup.generation.promptVersion,
      schemaVersion: current.setup.generation.schemaVersion,
      grant: current.grant,
      stage: "analysis",
      checkpoint: null,
      cancellationRequested: false,
      usage: { kind: "known", inputTokens: 0, outputTokens: 0 },
      state: "queued",
    })
  }
  function worker(callback: typeof saveQuestions = saveQuestions) {
    return new WorkerRuntime({
      storage,
      clock: () => new Date(),
      leaseDurationMs: 120000,
      tokenFactory: randomUUID,
      attemptIdFactory: () => randomUUID(),
      resolveStage: (job) =>
        job.id === "local-other"
          ? { kind: "local", execute: () => contentDigest("synthetic-local-result") }
          : {
              kind: "structured",
              runner: new ProviderRunner({
                storage,
                ownerId: "owner-1",
                installationId: "installation-1",
                clock: () => new Date(),
                adapters: { openrouter: { measure: async () => 1000, dispatch } },
              }),
              request: {
                ...questionsStage(storage, job),
                onValidated: () => callback(storage, job),
              },
            },
    })
  }
  return {
    storage,
    scope,
    capture,
    legacy,
    local,
    worker,
    dispatch,
    close: () => {
      storage.close()
      rmSync(directory, { recursive: true, force: true })
    },
  }
}
