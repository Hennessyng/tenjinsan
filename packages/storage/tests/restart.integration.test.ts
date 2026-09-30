import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AnalysisCacheInput, analysisCacheKey } from "@reading-studio/contracts"
import { afterEach, expect, it } from "vitest"
import { openStorage } from "../src/index.ts"
import { completeGraphFixtures } from "./fixtures.ts"

const temporaryDirectories: string[] = []

function temporaryStorage() {
  const directory = mkdtempSync(join(tmpdir(), "reading-studio-storage-"))
  temporaryDirectories.push(directory)
  return {
    databasePath: join(directory, "studio.sqlite"),
    privateDataRoot: join(directory, "private-data"),
  }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

it("applies migrations repeatedly and reopens a complete graph with two studies on one edition", () => {
  const paths = temporaryStorage()
  const fixture = completeGraphFixtures("openrouter")
  const analysis = {
    ...fixture.analysis,
    cacheKey: analysisCacheKey(AnalysisCacheInput.parse(fixture.analysis.cacheInput)),
  }
  const storage = openStorage(paths)

  storage.sources.createOwner("owner-1")
  storage.sources.createInstallation({ id: "installation-1", ownerId: "owner-1" })
  storage.sources.appendEdition(fixture.edition)
  storage.sources.createStudy({ id: "study-1", ownerId: "owner-1", editionId: "edition-1" })
  storage.sources.createStudy({ id: "study-2", ownerId: "owner-1", editionId: "edition-1" })
  storage.sources.appendNormalization({ record: fixture.normalization, parentRevisionId: null })
  storage.sources.appendSetup({ record: fixture.setup, parentRevisionId: null })
  storage.sources.appendSetup({
    record: { ...fixture.setup, id: "setup-2", studyId: "study-2" },
    parentRevisionId: null,
  })
  storage.sources.appendGrant(fixture.grant)
  storage.workflow.appendAnalysis({ record: analysis, parentRevisionId: null })
  storage.workflow.appendQuestion({ record: fixture.question, parentRevisionId: null })
  storage.workflow.appendAnswer({
    id: "input-1",
    studyId: "study-1",
    parentRevisionId: null,
    submission: fixture.submission,
  })
  storage.workflow.appendBrief({ record: fixture.brief, parentRevisionId: null })
  storage.workflow.appendOutline({ record: fixture.outline, parentRevisionId: null })
  storage.workflow.appendLesson({ record: fixture.lesson, parentRevisionId: null })
  storage.workflow.appendEvidenceReport(fixture.evidenceReport)
  storage.workflow.appendPrivacyReview({ record: fixture.privacyReview, parentRevisionId: null })
  storage.workflow.appendPublication({ record: fixture.publication, parentRevisionId: null })
  storage.execution.appendRun({ ...fixture.run, state: "running" })
  storage.execution.appendAttempt(fixture.attempt)
  storage.execution.appendJob(fixture.job)
  const claimed = storage.execution.claimNextJob({
    token: "restart-test-worker",
    now: "2026-09-21T00:00:01Z",
    expiresAt: "2026-09-21T00:00:02Z",
  })
  if (claimed?.state !== "running") throw new TypeError("restart test job claim failed")
  storage.execution.appendArtifact({
    jobId: claimed.id,
    token: claimed.lease.token,
    fence: claimed.lease.fence,
    now: "2026-09-21T00:00:01Z",
    artifact: fixture.artifact,
  })
  storage.close()

  const reopened = openStorage(paths)
  const studies = reopened.sources.listStudiesByEdition("edition-1")
  expect(studies.map((study) => study.id)).toEqual(["study-1", "study-2"])
  expect(reopened.sources.getEdition("edition-1")?.id).toBe("edition-1")
  const resource = reopened.sources.getNormalization("normalization-1")?.resources[0]
  expect(resource?.status).toBe("included")
  expect(resource?.status === "included" ? resource.blocks[0]?.id : undefined).toBe("block-1")
  expect(reopened.workflow.getAnalysis("analysis-1")?.id).toBe("analysis-1")
  expect(reopened.workflow.getAnswer("input-1")?.answer.questionRevisionId).toBe(
    "question-revision-1",
  )
  expect(reopened.workflow.getPublication("publication-1")?.privacyReview.id).toBe("privacy-1")
  expect(reopened.execution.getArtifact("artifact-1")?.provenance.jobId).toBe("job-1")
  expect(reopened.counts()).toMatchObject({
    editions: 1,
    studies: 2,
    normalizations: 1,
    sourceBlocks: 1,
    setups: 2,
    grants: 1,
    analyses: 1,
    questions: 1,
    answers: 1,
    briefs: 1,
    outlines: 1,
    lessons: 1,
    evidenceReports: 1,
    approvals: 3,
    privacyReviews: 1,
    publications: 1,
    runs: 1,
    attempts: 1,
    jobs: 1,
    artifacts: 1,
  })
  reopened.close()
})
