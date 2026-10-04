import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import {
  configuredCredential,
  modelChoices,
  ProviderAdapter,
  ProviderRunner,
} from "@reading-studio/providers"
import { z } from "zod"
import { WorkerRuntime } from "../src/runtime.ts"
import { seedQueuedJob } from "../tests/fixtures.ts"

const reportPath =
  process.env["LIVE_SMOKE_REPORT"] ?? ".omo/evidence/reading-studio/task-31/live-smoke.json"
const choices = modelChoices.filter((choice) => configuredCredential(choice.provider))
const report: {
  status: "BLOCKED" | "PASS" | "FAIL"
  reason?: string
  callCount: number
  providers: { provider: string; model: string; status: string }[]
  f4: { status: "BLOCKED"; sourceCheckedBooks: 0; reason: string }
} = {
  status: "BLOCKED",
  callCount: 0,
  providers: [],
  f4: {
    status: "BLOCKED",
    sourceCheckedBooks: 0,
    reason:
      "Synthetic smoke cannot establish F4. Two privately permitted Codex studio studies and manual source checks are required.",
  },
}

async function main(): Promise<void> {
  if (process.env["LIVE_SMOKE_CONSENT"] !== "yes" || choices.length === 0) {
    report.reason =
      choices.length === 0
        ? "No Anthropic smoke credential configured; no live request made. OpenRouter and official Codex live proof requires owner Setup/Send in the studio."
        : "LIVE_SMOKE_CONSENT=yes required; no live request made"
    process.exitCode = 2
    return
  }

  report.status = "PASS"
  for (const choice of choices) {
    const apiKey = configuredCredential(choice.provider)
    if (!apiKey) throw new TypeError("Credential disappeared after smoke preflight")
    const fixture = seedQueuedJob({ provider: choice.provider, model: choice.model, maxCalls: 1 })
    try {
      const runner = new ProviderRunner({
        storage: fixture.storage,
        installationId: "installation-1",
        ownerId: "owner-1",
        clock: () => new Date(),
        adapters: { [choice.provider]: new ProviderAdapter({ provider: choice.provider, apiKey }) },
      })
      const worker = new WorkerRuntime({
        storage: fixture.storage,
        clock: () => new Date(),
        leaseDurationMs: 120000,
        tokenFactory: () => "live-smoke",
        attemptIdFactory: () => "live-attempt",
        resolveStage: () => ({
          kind: "structured",
          runner,
          request: {
            instruction: "Return a short answer describing the synthetic source text.",
            schema: z.strictObject({ answer: z.string() }),
          },
        }),
      })
      const result = await worker.runNext()
      const job = fixture.storage.execution.getJob(fixture.job.id)
      const passed = result.kind === "provider" && job?.state === "completed"
      report.providers.push({
        provider: choice.provider,
        model: choice.model,
        status: passed ? "PASS" : "FAIL",
      })
      if (!passed) report.status = "FAIL"
    } finally {
      report.callCount += fixture.storage.execution
        .listAttempts(fixture.job.runId)
        .filter((attempt) => attempt.state !== "prepared").length
      fixture.storage.close()
      rmSync(fixture.directory, { recursive: true, force: true })
    }
  }
  if (report.status === "FAIL") process.exitCode = 1
}

try {
  await main()
} catch {
  report.status = "FAIL"
  report.reason =
    "Live provider call failed; inspect provider health without logging source or secrets"
  process.exitCode = 1
} finally {
  mkdirSync(dirname(reportPath), { recursive: true })
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
  process.stdout.write(`${JSON.stringify(report)}\n`)
}
