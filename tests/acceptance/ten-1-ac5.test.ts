import { rmSync } from "node:fs"
import { expect, it } from "vitest"
import { projectOwnerJobs } from "../../apps/server/src/job-projection.ts"
import { seedQueuedJob } from "../../apps/worker/tests/fixtures.ts"
import { openStorage } from "../../packages/storage/src/storage.ts"

it("keeps historical OpenAI work readable but unclaimable after restart", () => {
  const fixture = seedQueuedJob()
  fixture.storage.close()
  const storage = openStorage({
    databasePath: fixture.databasePath,
    privateDataRoot: fixture.privateDataRoot,
  })
  try {
    const claim = storage.execution.claimNextJob({
      token: "restarted-worker",
      now: "2026-01-01T00:00:00Z",
      expiresAt: "2026-01-01T00:10:00Z",
    })
    expect(claim).toBeNull()
    expect(projectOwnerJobs(storage, "owner-1").jobs[0]).toMatchObject({
      provider: "openai",
      state: "historical-inert",
      canRetry: false,
      unknownAttemptId: null,
    })
    expect(storage.execution.getJob(fixture.job.id)?.provider).toBe("openai")
    expect(storage.execution.listAttempts(fixture.job.runId)).toHaveLength(0)
    expect(() =>
      storage.execution.decideOwnerJob({
        jobId: fixture.job.id,
        ownerId: "owner-1",
        expectedSetupRevisionId: fixture.job.setupRevisionId,
        action: "retry",
        reason: "Owner requests retry",
      }),
    ).toThrow()
  } finally {
    storage.close()
    rmSync(fixture.directory, { recursive: true, force: true })
  }
})
