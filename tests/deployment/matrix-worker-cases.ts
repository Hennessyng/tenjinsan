import { type APIResponse, expect } from "@playwright/test"
import { z } from "zod"
import type { MatrixDeployment } from "./matrix-driver.ts"
import { recordCase } from "./matrix-evidence.ts"
import { until } from "./matrix-provider-failures.ts"

type CreateSetup = (provider: "openai" | "anthropic") => Promise<string>
type Post = (path: string, data: object) => Promise<APIResponse>

export async function runAcceptedCrashCase(
  deployment: MatrixDeployment,
  createSetup: CreateSetup,
  post: Post,
) {
  await deployment.fault("hold")
  const setupId = await createSetup("openai")
  const dispatched = await until(async () => {
    const snapshot = await deployment.snapshot(setupId)
    return (
      snapshot.setup?.jobs.find((job) =>
        job.attempts.some((attempt) => attempt.state === "dispatching"),
      ) ?? null
    )
  }, "accepted dispatch")
  const calls = await until(async () => {
    const count = await deployment.heldCount()
    return count === 1 ? count : null
  }, "wire accepted dispatch")
  expect(calls).toBe(1)
  await deployment.restartWorker(setupId, dispatched.id)
  const paused = await until(async () => {
    const snapshot = await deployment.snapshot(setupId)
    return (
      snapshot.setup?.jobs.find((job) => job.id === dispatched.id && job.state === "paused") ?? null
    )
  }, "unknown outcome")
  expect(paused.reason).toBe("outcome_unknown")
  expect(paused.attempts).toMatchObject([
    { state: "outcome_unknown", resolution: "awaiting-owner", usage: "unknown" },
  ])
  expect(await deployment.heldCount()).toBeGreaterThanOrEqual(calls)
  const visible = await deployment.page.request.get(`${deployment.origin}/api/study-jobs`)
  expect(visible.status()).toBe(200)
  const ledger = z
    .object({
      jobs: z.array(
        z.object({ id: z.string(), state: z.string(), usage: z.object({ kind: z.string() }) }),
      ),
    })
    .parse(await visible.json())
  expect(ledger.jobs.find((job) => job.id === paused.id)).toMatchObject({
    state: "paused",
    usage: { kind: "unknown" },
  })
  const stopped = await post(`/api/study-jobs/${paused.id}/resolve`, {
    expectedSetupRevisionId: setupId,
    choice: "stop-approved",
    confirmation: "stop-approved",
    reason: "Accepted synthetic request may have incurred a charge",
  })
  expect(stopped.status()).toBe(200)
  const resolved = await deployment.snapshot(setupId)
  expect(resolved.setup?.jobs.find((job) => job.id === paused.id)?.attempts).toMatchObject([
    { state: "outcome_unknown", resolution: "stop-approved", usage: "unknown" },
  ])
  expect(await deployment.heldCount()).toBeGreaterThanOrEqual(calls)
  await deployment.fault("normal")
  await deployment.releaseHeld()
  return recordCase(
    deployment,
    {
      name: "accepted-crash",
      http: visible.status(),
      job: paused.state,
      attempts: ["outcome_unknown"],
    },
    setupId,
  )
}

export async function runCancelledStaleCase(
  deployment: MatrixDeployment,
  createSetup: CreateSetup,
  post: Post,
) {
  await deployment.fault("hold")
  const staleSetupId = await createSetup("openai")
  const running = await until(async () => {
    const snapshot = await deployment.snapshot(staleSetupId)
    return (
      snapshot.setup?.jobs.find(
        (job) =>
          job.state === "running" &&
          job.attempts.some((attempt) => attempt.state === "dispatching"),
      ) ?? null
    )
  }, "held worker")
  if (!running.lease) throw new TypeError("Missing claimed lease")
  await deployment.rememberLease(running.id)
  const acknowledged = await post(`/api/study-jobs/${running.id}/cancel`, {
    expectedSetupRevisionId: staleSetupId,
    choice: "stop-approved",
    confirmation: "stop-approved",
    reason: "Stop the accepted synthetic request even if charged",
  })
  expect(acknowledged.status()).toBe(200)
  await deployment.fault("normal")
  const currentSetupId = await createSetup("anthropic")
  expect(currentSetupId).not.toBe(staleSetupId)
  await deployment.releaseHeld()
  const cancelled = await until(async () => {
    const snapshot = await deployment.snapshot(staleSetupId)
    return (
      snapshot.setup?.jobs.find((job) => job.id === running.id && job.state === "cancelled") ?? null
    )
  }, "old worker cancellation")
  expect(cancelled.attempts).toMatchObject([
    { state: "outcome_unknown", resolution: "stop-approved", usage: "unknown" },
  ])
  expect(await deployment.rejectStaleCommit(running.id, running.lease)).toBe(true)
  expect(
    (await deployment.snapshot(staleSetupId)).setup?.jobs.find((job) => job.id === running.id)
      ?.state,
  ).toBe("cancelled")
  return recordCase(
    deployment,
    {
      name: "cancelled-stale-revision",
      http: acknowledged.status(),
      job: "cancelled",
      attempts: ["outcome_unknown"],
    },
    staleSetupId,
  )
}
