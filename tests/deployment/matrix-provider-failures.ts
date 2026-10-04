import { expect } from "@playwright/test"
import { z } from "zod"
import type { MatrixDeployment } from "./matrix-driver.ts"
import { recordCase } from "./matrix-evidence.ts"

export async function until<T>(read: () => Promise<T | null>, label: string): Promise<T> {
  const deadline = Date.now() + 25_000
  while (Date.now() < deadline) {
    const value = await read()
    if (value !== null) return value
    await new Promise<void>((resolve) => setTimeout(resolve, 100))
  }
  throw new TypeError(`${label} did not reach the expected state`)
}

export async function runProviderFailureCase(
  deployment: MatrixDeployment,
  createSetup: (provider: "openrouter" | "anthropic") => Promise<string>,
  fault: "malformed-output" | "invalid-citation",
) {
  await deployment.fault(fault)
  const setupId = await createSetup("openrouter")
  const failed = await until(async () => {
    const snapshot = await deployment.snapshot(setupId)
    return snapshot.setup?.jobs.find((job) => job.state === "failed") ?? null
  }, fault)
  const persisted = await deployment.snapshot(setupId)
  expect(failed.failureCode).toBe("malformed-output")
  expect(failed.attempts.map((attempt) => attempt.state)).toEqual([
    "response-received",
    "response-received",
  ])
  expect(persisted.setup?.interviewId).toBeNull()
  expect(persisted.setup?.lessonId).toBeNull()
  expect(persisted.setup?.publications).toBe(0)
  const publicJobs = await deployment.page.request.get(`${deployment.origin}/api/study-jobs`)
  expect(publicJobs.status()).toBe(200)
  expect(
    z
      .object({ jobs: z.array(z.object({ id: z.string(), failureCode: z.string().nullable() })) })
      .parse(await publicJobs.json())
      .jobs.find((job) => job.id === failed.id)?.failureCode,
  ).toBe("malformed-output")
  await deployment.page.goto(`${deployment.origin}/jobs`)
  await expect(deployment.page.getByText("malformed-output").first()).toBeVisible()
  return recordCase(
    deployment,
    {
      name: fault,
      http: publicJobs.status(),
      job: failed.state,
      attempts: failed.attempts.map((attempt) => attempt.state),
    },
    setupId,
  )
}
