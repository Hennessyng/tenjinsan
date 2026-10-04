import { expect, test } from "vitest"
import { createApp } from "./app.ts"
import { ownerJobsFixture } from "./testing/owner-jobs-fixture.ts"

test("does not expose a valid job to another authenticated owner identity", async () => {
  // Given: an otherwise valid session identity that does not own the job.
  const { fixture } = await ownerJobsFixture()
  try {
    const foreign = createApp({
      auth: {
        handler: async () => new Response(null, { status: 404 }),
        ownerId: async () => "foreign-owner",
      },
      reviewStorage: fixture.storage,
      security: {
        apiBodyBytes: 1024,
        loginBodyBytes: 4096,
        loginRateLimit: { attempts: 5, windowMs: 60000 },
        trustedOrigins: [fixture.origin],
        trustProxy: false,
        uploadBodyBytes: 8192,
        logger: () => undefined,
      },
    })
    // When: that identity reads or tries to cancel the owner's real SQLite job.
    const list = await foreign.request(`${fixture.origin}/api/study-jobs`)
    const denied = await foreign.request(`${fixture.origin}/api/study-jobs/job-jobs/cancel`, {
      method: "POST",
      headers: { origin: fixture.origin, "content-type": "application/json" },
      body: JSON.stringify({ expectedSetupRevisionId: "setup-jobs" }),
    })
    // Then: both read and write stay scoped to the authenticated owner.
    expect(await list.json()).toMatchObject({ jobs: [] })
    expect(denied.status).toBe(404)
    expect(fixture.storage.execution.getJob("job-jobs")?.state).toBe("queued")
  } finally {
    await fixture.close()
  }
})

test("hides a superseded setup and refuses an old job decision", async () => {
  // Given: the owner has approved a new setup after the old job was queued.
  const { fixture, cookie } = await ownerJobsFixture()
  try {
    const prior = fixture.storage.sources.getSetup("setup-jobs")
    if (!prior) throw new TypeError("Fixture setup missing")
    fixture.storage.sources.appendSetup({
      parentRevisionId: prior.id,
      record: { ...prior, id: "setup-current" },
    })
    // When: the owner reads jobs and submits the old job decision.
    const list = await fetch(`${fixture.origin}/api/study-jobs`, { headers: { cookie } })
    const denied = await fetch(`${fixture.origin}/api/study-jobs/job-jobs/cancel`, {
      method: "POST",
      headers: { cookie, origin: fixture.origin, "content-type": "application/json" },
      body: JSON.stringify({ expectedSetupRevisionId: prior.id }),
    })
    // Then: the old job is not projected and cannot be changed.
    expect(await list.json()).toMatchObject({ jobs: [] })
    expect(denied.status).toBe(409)
    expect(fixture.storage.execution.getJob("job-jobs")?.state).toBe("queued")
  } finally {
    await fixture.close()
  }
})
