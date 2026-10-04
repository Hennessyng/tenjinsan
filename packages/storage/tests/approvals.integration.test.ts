import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, expect, it } from "vitest"
import { openStorage, type Storage } from "../src/index.ts"
import {
  approvalContent as content,
  approvalGraph as graph,
  seedApprovalStorage,
} from "./approval-fixture.ts"

let storage: Storage
let directory: string
let paths: { readonly databasePath: string; readonly privateDataRoot: string }
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "brief-approvals-"))
  paths = {
    databasePath: join(directory, "test.sqlite"),
    privateDataRoot: join(directory, "private"),
  }
  storage = openStorage(paths)
  seedApprovalStorage(storage)
})
afterEach(() => {
  storage.close()
  rmSync(directory, { recursive: true, force: true })
})

function draft() {
  return storage.briefs.save({ studyId: "study-1", expectedRevisionId: null, content })
}

it("blocks outline enqueue when no precise brief approval exists", () => {
  // Given
  const brief = draft()
  storage.execution.appendRun({ ...graph.run, inputRevisionId: brief.id })
  // When / Then
  expect(() =>
    storage.execution.appendJob({ ...graph.job, stage: "outline", inputRevisionId: brief.id }),
  ).toThrow("brief approval")
  expect(storage.counts()).toMatchObject({ jobs: 0, approvals: 0 })
})

it("persists the original question and exact revision when explicitly approved", () => {
  // Given
  const brief = draft()
  // When
  storage.briefs.decide({ studyId: "study-1", revisionId: brief.id, action: "approve" })
  storage.close()
  storage = openStorage(paths)
  // Then
  expect(storage.briefs.current("study-1")).toMatchObject({
    draft: { id: brief.id },
    status: "approved",
  })
  expect(storage.briefs.approved(brief.id)?.guidingQuestion).toEqual(content.originalQuestion)
  expect(storage.counts()).toMatchObject({ briefs: 1, approvals: 1, jobs: 0 })
})

it("rejects stale approval and invalidates descendants when an approved brief is edited", () => {
  // Given
  const first = draft()
  storage.briefs.decide({ studyId: "study-1", revisionId: first.id, action: "approve" })
  storage.workflow.appendOutline({
    record: { ...graph.outline, briefRevisionId: first.id },
    parentRevisionId: null,
  })
  storage.workflow.appendLesson({
    record: { ...graph.lesson, briefRevisionId: first.id },
    parentRevisionId: null,
  })
  storage.workflow.appendEvidenceReport(graph.evidenceReport)
  storage.workflow.appendPrivacyReview({ record: graph.privacyReview, parentRevisionId: null })
  storage.workflow.appendPublication({ record: graph.publication, parentRevisionId: null })
  storage.execution.appendRun({ ...graph.run, inputRevisionId: first.id })
  storage.execution.appendJob({ ...graph.job, inputRevisionId: first.id })
  storage.execution.claimNextJob({
    token: "lease",
    now: "2026-09-23T01:00:00Z",
    expiresAt: "2026-09-23T01:01:00Z",
  })
  storage.execution.commitArtifact({
    artifact: graph.artifact,
    jobId: graph.job.id,
    token: "lease",
    fence: 1,
    now: "2026-09-23T01:00:01Z",
  })
  // When
  const second = storage.briefs.save({
    studyId: "study-1",
    expectedRevisionId: first.id,
    content: { ...content, questionChoice: "refined" },
  })
  // Then
  expect(storage.briefs.current("study-1")).toMatchObject({
    status: "pending",
    draft: { id: second.id },
  })
  expect(storage.briefs.approved(first.id)).toBeNull()
  expect(storage.briefs.descendants("study-1").map((entry) => [entry.kind, entry.status])).toEqual([
    ["outline", "outdated"],
    ["lesson", "outdated"],
    ["evidence", "outdated"],
    ["publication", "outdated"],
    ["artifact", "outdated"],
  ])
  expect(storage.briefs.descendants("study-1")).toContainEqual({
    id: "outline-1",
    kind: "outline",
    status: "outdated",
  })
  expect(() =>
    storage.briefs.decide({ studyId: "study-1", revisionId: first.id, action: "approve" }),
  ).toThrow("stale brief")
  expect(() =>
    storage.workflow.appendOutline({
      record: {
        ...graph.outline,
        id: "outline-2",
        approval: { ...graph.outline.approval, revisionId: "outline-2" },
        briefRevisionId: first.id,
      },
      parentRevisionId: null,
    }),
  ).toThrow("brief approval")
  expect(() =>
    storage.workflow.appendPublication({
      record: { ...graph.publication, id: "publication-stale" },
      parentRevisionId: graph.publication.id,
    }),
  ).toThrow()
})

it("rejects approval after setup changes and retains the original question during revision", () => {
  // Given
  const first = draft()
  storage.sources.appendSetup({
    record: { ...graph.setup, id: "setup-2" },
    parentRevisionId: "setup-1",
  })
  // When / Then
  expect(() =>
    storage.briefs.decide({ studyId: "study-1", revisionId: first.id, action: "approve" }),
  ).toThrow("stale brief")
  expect(() =>
    storage.briefs.save({
      studyId: "study-1",
      expectedRevisionId: first.id,
      content: { ...content, originalQuestion: { en: "Replacement", ja: "変更" } },
    }),
  ).toThrow("original question")
  expect(storage.briefs.current("study-1")?.status).toBe("outdated")
})

it.each(["defer", "revise"])(
  "retains a non-approved state when the reader chooses %s",
  (action) => {
    // Given
    const brief = draft()
    // When
    storage.briefs.decide({ studyId: "study-1", revisionId: brief.id, action })
    // Then
    expect(storage.briefs.approved(brief.id)).toBeNull()
    expect(storage.counts()).toMatchObject({ approvals: 0, jobs: 0 })
  },
)

it("rejects approval when interview answers changed since review", () => {
  // Given
  const brief = draft()
  storage.interviews.save({
    studyId: "study-1",
    interviewId: "interview-1",
    answer: graph.submission.answer,
  })
  // When / Then
  expect(() =>
    storage.briefs.decide({ studyId: "study-1", revisionId: brief.id, action: "approve" }),
  ).toThrow("stale brief")
  expect(storage.briefs.current("study-1")?.status).toBe("outdated")
})

it("allows an outline job only for the approved current brief", () => {
  // Given
  const brief = draft()
  storage.briefs.decide({ studyId: "study-1", revisionId: brief.id, action: "approve" })
  storage.execution.appendRun({ ...graph.run, inputRevisionId: brief.id })
  // When
  const job = storage.execution.appendJob({
    ...graph.job,
    stage: "outline",
    inputRevisionId: brief.id,
  })
  // Then
  expect(job.inputRevisionId).toBe(brief.id)
})

it("does not claim an old outline job when approval has been invalidated", () => {
  // Given
  const brief = draft()
  storage.briefs.decide({ studyId: "study-1", revisionId: brief.id, action: "approve" })
  storage.execution.appendRun({ ...graph.run, inputRevisionId: brief.id })
  storage.execution.appendJob({ ...graph.job, stage: "outline", inputRevisionId: brief.id })
  storage.briefs.save({
    studyId: "study-1",
    expectedRevisionId: brief.id,
    content: { ...content, depth: "overview" },
  })
  // When
  const claimed = storage.execution.claimNextJob({
    token: "lease",
    now: "2026-09-23T01:00:00Z",
    expiresAt: "2026-09-23T01:01:00Z",
  })
  // Then
  expect(claimed).toBeNull()
  expect(storage.execution.getJob(graph.job.id)?.state).toBe("cancelled")
})

it("rejects a running outline result when the reader edits its brief", () => {
  // Given
  const brief = draft()
  storage.briefs.decide({ studyId: "study-1", revisionId: brief.id, action: "approve" })
  storage.execution.appendRun({ ...graph.run, inputRevisionId: brief.id })
  storage.execution.appendJob({ ...graph.job, stage: "outline", inputRevisionId: brief.id })
  storage.execution.claimNextJob({
    token: "lease",
    now: "2026-09-23T01:00:00Z",
    expiresAt: "2026-09-23T01:01:00Z",
  })
  storage.briefs.save({
    studyId: "study-1",
    expectedRevisionId: brief.id,
    content: { ...content, depth: "overview" },
  })
  // When / Then
  expect(() =>
    storage.execution.completeJob({
      jobId: graph.job.id,
      token: "lease",
      fence: 1,
      now: "2026-09-23T01:00:01Z",
      resultHash: "b".repeat(64),
    }),
  ).toThrow("brief approval")
})
