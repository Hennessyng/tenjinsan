import { randomUUID } from "node:crypto"
import { FixtureDatabase as Database } from "@reading-studio/storage/test-support"
import { afterEach, expect, it } from "vitest"
import { analysisPurposeFixture } from "./analysis-purpose-fixture.ts"
import { bookFixtureTurns } from "./book-map-route-fixture.ts"

const fixtures: Awaited<ReturnType<typeof analysisPurposeFixture>>[] = []
afterEach(async () => {
  for (const item of fixtures.splice(0)) await item.fixture.close()
})
async function given() {
  const item = await analysisPurposeFixture()
  fixtures.push(item)
  return item
}
it("does not accept a purpose task as completed without its durable native receipt", async () => {
  const item = await given(),
    execution = item.fixture.storage.execution
  item.runtime().pipeline.prepare(item.setup.id, item.grant.id)
  const now = "2026-10-23T00:00:00.000Z"
  const job = execution.claimNextJob({
    now,
    token: randomUUID(),
    expiresAt: "2026-10-23T01:00:00.000Z",
  })
  if (job?.state !== "running") throw new TypeError("Missing claimed purpose job")
  expect(() =>
    execution.completeJob({
      jobId: job.id,
      token: job.lease.token,
      fence: job.lease.fence,
      now,
      resultHash: "a".repeat(64),
    }),
  ).toThrow()
  expect(execution.getJob(job.id)?.state).toBe("running")
  expect(item.fixture.storage.liveStudyGuard.used()).toBe(0)
})
it.each(["questions", "outline", "lesson", "artifact", "analysis"] as const)(
  "fences raw SQL %s forgery before any attempt",
  async (stage) => {
    const item = await given(),
      run = item.runtime(),
      execution = item.fixture.storage.execution
    run.pipeline.prepare(item.setup.id, item.grant.id)
    const template = execution.listSetupJobs(item.setup.id)[0]
    if (!template) throw new TypeError("Missing authorized template")
    execution.requestCancellation({ jobId: template.id })
    const id = `raw-${stage}`
    execution.appendRun({
      id,
      inputRevisionId: template.inputRevisionId,
      budget: { maxCalls: 20 },
      reservedCalls: 0,
      state: "running",
    })
    const db = new Database(item.options.databasePath)
    const insert = () =>
      db
        .prepare(
          "INSERT INTO jobs(id,run_id,input_revision_id,setup_revision_id,grant_id,state,record_json) VALUES(?,?,?,?,?,'queued',?)",
        )
        .run(
          id,
          id,
          template.inputRevisionId,
          item.setup.id,
          item.grant.id,
          JSON.stringify({ ...template, id, runId: id, stage, foundationTask: undefined }),
        )
    try {
      if (stage === "outline" || stage === "lesson") {
        expect(insert).toThrow(
          stage === "outline"
            ? "current brief approval required"
            : "current outline approval required",
        )
        expect(execution.getJob(id)).toBeNull()
        expect(execution.listAttempts(id)).toHaveLength(0)
        return
      }
      insert()
    } finally {
      db.close()
    }
    await run.worker.runNext()
    await run.worker.runNext()
    expect(execution.getJob(id)?.state).toBe("cancelled")
    expect(execution.listAttempts(id)).toHaveLength(0)
    expect(item.fixture.storage.liveStudyGuard.used()).toBe(0)
    expect(bookFixtureTurns(item.fixture)).toHaveLength(0)
  },
)
it.each(["reservation", "dispatch", "receipt", "completion"] as const)(
  "rechecks purpose at %s after raw post-claim substitution",
  async (boundary) => {
    const item = await given(),
      execution = item.fixture.storage.execution
    item.runtime().pipeline.prepare(item.setup.id, item.grant.id)
    const now = "2026-10-23T00:00:00.000Z"
    const job = execution.claimNextJob({
      now,
      token: randomUUID(),
      expiresAt: "2026-10-23T01:00:00.000Z",
    })
    if (job?.state !== "running") throw new TypeError("Missing claimed purpose job")
    const lease = { jobId: job.id, token: job.lease.token, fence: job.lease.fence, now }
    if (boundary !== "reservation")
      expect(
        execution.reserveAttempt({ ...lease, attemptId: "attempt-boundary", preparedAt: now }).kind,
      ).toBe("prepared")
    if (boundary === "receipt" || boundary === "completion")
      execution.markAttemptDispatching({
        ...lease,
        attemptId: "attempt-boundary",
        dispatchedAt: now,
      })
    const db = new Database(item.options.databasePath)
    try {
      db.prepare("UPDATE jobs SET record_json=? WHERE id=?").run(
        JSON.stringify({ ...job, stage: "questions", foundationTask: undefined }),
        job.id,
      )
    } finally {
      db.close()
    }
    expect(() => {
      switch (boundary) {
        case "reservation":
          execution.reserveAttempt({ ...lease, attemptId: "attempt-boundary", preparedAt: now })
          break
        case "dispatch":
          execution.markAttemptDispatching({
            ...lease,
            attemptId: "attempt-boundary",
            dispatchedAt: now,
          })
          break
        case "receipt":
          execution.recordAttemptReceipt({
            ...lease,
            attemptId: "attempt-boundary",
            receivedAt: now,
            responseBody: new TextEncoder().encode("{}"),
            usage: { kind: "unknown" },
          })
          break
        case "completion":
          execution.completeJob({ ...lease, resultHash: "a".repeat(64) })
          break
        default: {
          const never: never = boundary
          throw new TypeError(String(never))
        }
      }
    }).toThrow()
    expect(item.fixture.storage.liveStudyGuard.used()).toBe(boundary === "reservation" ? 0 : 1)
    expect(bookFixtureTurns(item.fixture)).toHaveLength(0)
  },
)
it.each([
  ["input", "INSERT INTO input_revisions(id,study_id,kind) VALUES('forged-input',?,'answer')"],
  [
    "interview",
    "INSERT INTO interview_definitions(id,study_id,record_json) VALUES('forged-interview',?,'{}')",
  ],
  [
    "brief",
    "INSERT INTO brief_revisions(id,study_id,setup_revision_id,analysis_revision_id,record_json) VALUES('forged-brief',?,'evaluation-setup','missing','{}')",
  ],
  [
    "outline",
    "INSERT INTO outline_drafts(id,study_id,brief_revision_id,record_json) VALUES('forged-outline',?,'missing','{}')",
  ],
  [
    "lesson/glossary",
    "INSERT INTO lesson_revisions(id,study_id,setup_revision_id,analysis_revision_id,brief_revision_id,outline_revision_id,record_json) VALUES('forged-lesson',?,'evaluation-setup','missing','missing','missing','{}')",
  ],
  [
    "publication/render",
    "INSERT INTO publication_snapshots(publication_id,study_id,review_id,record_json) VALUES('forged-publication',?,'missing','{}')",
  ],
] as const)(
  "makes later %s mutation inaccessible even through a raw writer",
  async (_name, sql) => {
    const item = await given(),
      before = item.fixture.storage.counts()
    const db = new Database(item.options.databasePath)
    try {
      expect(() => db.prepare(sql).run(item.setup.studyId)).toThrow("analysis-evaluation-purpose")
    } finally {
      db.close()
    }
    expect(item.fixture.storage.counts()).toEqual(before)
  },
)
