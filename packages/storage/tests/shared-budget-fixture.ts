import { randomUUID } from "node:crypto"
import { contentDigest, StudySetupRevision } from "@reading-studio/contracts"
import Database from "better-sqlite3"
import { completeGraphFixtures } from "./fixtures.ts"
import { guardNow, liveStudyFixture } from "./live-study-fixture.ts"

export function sharedBudgetFixture() {
  const fixture = liveStudyFixture(true)
  fixture.reopen(fixture.target)
  fixture.queue("live", 2)
  for (let index = 0; index < 2; index++) {
    const lease = fixture.claim()
    for (let attempt = 0; attempt < (index === 0 ? 2 : 1); attempt++) {
      const reserved = fixture.reserve(lease)
      if (reserved.kind !== "prepared") throw new TypeError("Fixture reservation missing")
      fixture.storage.execution.markAttemptDispatching({
        ...lease,
        attemptId: reserved.attempt.id,
        dispatchedAt: guardNow,
      })
      fixture.storage.execution.recordAttemptReceipt({
        ...lease,
        attemptId: reserved.attempt.id,
        receivedAt: guardNow,
        responseBody: new TextEncoder().encode("{}"),
        usage: { kind: "unknown" },
      })
    }
    fixture.complete(lease)
  }
  const setup = fixture.storage.sources.getSetup(fixture.target.setupRevisionId)
  if (!setup) throw new TypeError("Fixture setup missing")
  const adoption = {
    id: randomUUID(),
    ownerId: "owner-1",
    sourceHash: fixture.target.sourceHash,
    members: [
      {
        authorizationId: fixture.target.authorizationId,
        expectedSpent: 3,
        setupHash: contentDigest(JSON.stringify(setup)),
      },
    ],
    reason: "Explicit synthetic recovery authorization",
  }
  let nextSetup = StudySetupRevision.parse({ ...setup, id: "setup-next", studyId: "study-next" })
  function prepareNext(record: StudySetupRevision = nextSetup) {
    nextSetup = record
    fixture.storage.sources.createStudy({
      id: nextSetup.studyId,
      ownerId: "owner-1",
      editionId: nextSetup.editionId,
    })
    fixture.storage.sources.appendSetup({ record: nextSetup, parentRevisionId: null })
    return {
      ...fixture.target,
      authorizationId: randomUUID(),
      studyId: nextSetup.studyId,
      setupRevisionId: nextSetup.id,
      model: nextSetup.analysis.model,
      budgetId: adoption.id,
      attemptLimit: 17,
    }
  }
  function history() {
    const db = new Database(fixture.options.databasePath, { readonly: true })
    try {
      return JSON.stringify(
        [
          "jobs",
          "generation_runs",
          "external_attempts",
          "transmission_grants",
          "live_study_guards",
        ].map((table) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()),
      )
    } finally {
      db.close()
    }
  }
  function queueNext(count: number, maxCalls = 1, derivedConsent = false) {
    const storage = fixture.storage
    const graph = completeGraphFixtures("openrouter")
    const grant = storage.sources.appendGrant({
      ...graph.grant,
      id: "grant-next",
      setupRevisionId: nextSetup.id,
      destination: nextSetup.analysis.destination,
      ...(derivedConsent
        ? { categories: ["book-text", "derived-study-material", "reader-context"] }
        : {}),
    })
    const inputRevisionId = storage.workflow.ensureAnalysisInput(nextSetup.id)
    for (let index = 0; index < count; index++) {
      const id = `next-${index}`
      storage.execution.appendRun({
        id,
        inputRevisionId,
        budget: { maxCalls },
        reservedCalls: 0,
        state: "running",
      })
      storage.execution.appendJob({
        ...graph.job,
        id,
        runId: id,
        inputRevisionId,
        setupRevisionId: nextSetup.id,
        grant,
        provider: nextSetup.analysis.provider,
        model: nextSetup.analysis.model,
        stage: "analysis",
        state: "queued",
      })
    }
    return Array.from({ length: count }, () => fixture.claim())
  }
  function unguardedPriorAttempt() {
    const storage = fixture.reopen()
    const graph = completeGraphFixtures("openrouter")
    const record = { ...nextSetup, id: "setup-unguarded", studyId: "study-unguarded" }
    storage.sources.createStudy({
      id: record.studyId,
      ownerId: "owner-1",
      editionId: record.editionId,
    })
    storage.sources.appendSetup({ record, parentRevisionId: null })
    const grant = storage.sources.appendGrant({
      ...graph.grant,
      id: "grant-unguarded",
      setupRevisionId: record.id,
      destination: record.analysis.destination,
    })
    const inputRevisionId = storage.workflow.ensureAnalysisInput(record.id)
    storage.execution.appendRun({
      id: "unguarded-run",
      inputRevisionId,
      budget: { maxCalls: 1 },
      reservedCalls: 0,
      state: "running",
    })
    storage.execution.appendJob({
      ...graph.job,
      id: "unguarded-job",
      runId: "unguarded-run",
      inputRevisionId,
      setupRevisionId: record.id,
      grant,
      provider: record.analysis.provider,
      model: record.analysis.model,
      stage: "analysis",
      state: "queued",
    })
    const lease = fixture.claim()
    const reserved = fixture.reserve(lease)
    if (reserved.kind !== "prepared") throw new TypeError("Unguarded fixture reservation missing")
    storage.execution.markAttemptDispatching({
      ...lease,
      attemptId: reserved.attempt.id,
      dispatchedAt: guardNow,
    })
    storage.execution.recordAttemptReceipt({
      ...lease,
      attemptId: reserved.attempt.id,
      receivedAt: guardNow,
      responseBody: new TextEncoder().encode("{}"),
      usage: { kind: "unknown" },
    })
    fixture.complete(lease)
  }
  function migrationBarrier() {
    const db = new Database(fixture.options.databasePath)
    try {
      db.exec(
        "INSERT INTO live_study_adoption_barriers SELECT g.authorization_id,s.owner_id FROM live_study_guards g JOIN studies s ON s.id=g.study_id",
      )
    } finally {
      db.close()
    }
  }
  return {
    fixture,
    adoption,
    setup,
    prepareNext,
    history,
    queueNext,
    unguardedPriorAttempt,
    migrationBarrier,
  }
}
