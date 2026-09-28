import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, expect, it } from "vitest"
import { openStorage, type Storage } from "../src/index.ts"
import { approvalContent, approvalGraph as graph, seedApprovalStorage } from "./approval-fixture.ts"

let storage: Storage
let directory: string
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "study-revisions-"))
  storage = openStorage({ databasePath: join(directory, "db"), privateDataRoot: directory })
  seedApprovalStorage(storage)
})
afterEach(() => {
  storage.close()
  rmSync(directory, { recursive: true, force: true })
})
const identity = { studyId: "study-1", ownerId: "owner-1", expectedSetupRevisionId: "setup-1" }

it("preserves immutable fork lineage and reuses only matching analysis when forking", () => {
  // Given / When
  const fork = storage.revisions.fork(identity)
  storage.close()
  storage = openStorage({ databasePath: join(directory, "db"), privateDataRoot: directory })
  // Then
  const state = storage.revisions.current({ studyId: fork.setup.studyId, ownerId: "owner-1" })
  expect(state.parent).toEqual({ studyId: "study-1", setupRevisionId: "setup-1" })
  expect(state.setup.editionId).toBe(graph.edition.id)
  expect(state.analysis?.id).toBe("analysis-1")
  expect(state.grant).toBeNull()
  expect(storage.sources.getLatestSetup("study-1")?.id).toBe("setup-1")
  expect(storage.interviews.latest(fork.setup.studyId)?.analysisRevisionId).toBe("analysis-1")
  expect(storage.briefs.current(fork.setup.studyId)).toBeNull()
})

it.each([
  { model: "another-model" },
  { provider: "anthropic", model: "claude-fixture" },
  { analysisPromptVersion: "analysis-2" },
  { analysisSchemaVersion: "analysis-2" },
  { settings: { ...graph.setup.analysis.settings, temperature: 0.8 } },
])("requires another analysis and grant when analysis settings change: %j", (change) => {
  // Given
  const draft = storage.briefs.save({
    studyId: "study-1",
    expectedRevisionId: null,
    content: approvalContent,
  })
  storage.briefs.decide({ studyId: "study-1", revisionId: draft.id, action: "approve" })
  // When
  const revised = storage.revisions.revise({
    ...identity,
    analysis: { ...graph.setup.analysis, ...change },
    generation: graph.setup.generation,
  })
  // Then
  expect(revised.analysis).toBeNull()
  expect(revised.grant).toBeNull()
  expect(storage.briefs.current("study-1")?.status).toBe("outdated")
  expect(storage.workflow.getAnalysis("analysis-1")).not.toBeNull()
  expect(() =>
    storage.interviews.save({
      studyId: "study-1",
      interviewId: "interview-1",
      answer: graph.submission.answer,
    }),
  ).toThrow("analysis")
})

it("retains lens-neutral analysis and answers when only generation changes", () => {
  // Given
  storage.interviews.save({
    studyId: "study-1",
    interviewId: "interview-1",
    answer: graph.submission.answer,
  })
  // When
  const revised = storage.revisions.revise({
    ...identity,
    analysis: graph.setup.analysis,
    generation: { ...graph.setup.generation, promptVersion: "generation-2" },
  })
  // Then
  expect(revised.analysis?.id).toBe("analysis-1")
  expect(storage.interviews.answers("interview-1")).toHaveLength(1)
  expect(() =>
    storage.revisions.revise({
      ...identity,
      analysis: graph.setup.analysis,
      generation: graph.setup.generation,
    }),
  ).toThrow("stale")
})

it("fences an old running analysis completion when setup changes", () => {
  // Given
  const inputRevisionId = storage.workflow.ensureAnalysisInput("setup-1")
  storage.execution.appendRun({ ...graph.run, inputRevisionId })
  storage.execution.appendJob({ ...graph.job, stage: "analysis", inputRevisionId })
  storage.execution.claimNextJob({
    token: "lease",
    now: "2026-09-23T01:00:00Z",
    expiresAt: "2026-09-23T01:01:00Z",
  })
  storage.revisions.revise({
    ...identity,
    analysis: { ...graph.setup.analysis, model: "other" },
    generation: graph.setup.generation,
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
  ).toThrow()
})

it("rejects another owner's fork without creating a study", () => {
  // Given / When / Then
  expect(() => storage.revisions.fork({ ...identity, ownerId: "other-owner" })).toThrow(
    "owned study",
  )
  expect(storage.counts().studies).toBe(1)
})

it.each(["scope", "normalizer"])("uses a new key when %s changes", (kind) => {
  // Given
  storage.sources.appendNormalization({
    record: { ...graph.normalization, id: "normalization-2", normalizerVersion: "normalizer-2" },
    parentRevisionId: graph.normalization.id,
  })
  const analysis =
    kind === "scope"
      ? { ...graph.setup.analysis, scope: { ...graph.setup.analysis.scope, kind: "partial" } }
      : { ...graph.setup.analysis, normalizationRevisionId: "normalization-2" }
  // When
  const revised = storage.revisions.revise({
    ...identity,
    analysis,
    generation: graph.setup.generation,
  })
  // Then
  expect(revised.analysis).toBeNull()
  expect(storage.sources.getSetup("setup-1")).toMatchObject({ analysis: graph.setup.analysis })
})

it("rejects old interview completions after a provider switch", () => {
  // Given
  const interview = storage.interviews.latest("study-1")
  storage.revisions.revise({
    ...identity,
    analysis: { ...graph.setup.analysis, provider: "anthropic", model: "claude" },
    generation: graph.setup.generation,
  })
  // When / Then
  expect(() => storage.interviews.create({ ...interview, id: "late-interview" })).toThrow(
    "analysis",
  )
  expect(storage.interviews.latest("study-1")?.id).toBe("interview-1")
})

it.each(["answer", "goal", "generation", "analysis"])(
  "invalidates publication approval and preserves history after a %s edit",
  (kind) => {
    // Given
    const brief = storage.briefs.save({
      studyId: "study-1",
      expectedRevisionId: null,
      content: approvalContent,
    })
    storage.briefs.decide({ studyId: "study-1", revisionId: brief.id, action: "approve" })
    storage.workflow.appendOutline({
      record: { ...graph.outline, briefRevisionId: brief.id },
      parentRevisionId: null,
    })
    storage.workflow.appendLesson({
      record: { ...graph.lesson, briefRevisionId: brief.id },
      parentRevisionId: null,
    })
    storage.workflow.appendEvidenceReport(graph.evidenceReport)
    storage.workflow.appendPrivacyReview({ record: graph.privacyReview, parentRevisionId: null })
    storage.workflow.appendPublication({ record: graph.publication, parentRevisionId: null })
    // When
    switch (kind) {
      case "answer":
        storage.interviews.save({
          studyId: "study-1",
          interviewId: "interview-1",
          answer: graph.submission.answer,
        })
        break
      case "goal":
        storage.briefs.save({
          studyId: "study-1",
          expectedRevisionId: brief.id,
          content: { ...approvalContent, purpose: "A different purpose" },
        })
        break
      case "generation":
        storage.revisions.revise({
          ...identity,
          analysis: graph.setup.analysis,
          generation: { ...graph.setup.generation, schemaVersion: "generation-2" },
        })
        break
      case "analysis":
        storage.revisions.revise({
          ...identity,
          analysis: { ...graph.setup.analysis, model: "new-model" },
          generation: graph.setup.generation,
        })
        break
      default:
        throw new TypeError("Unknown test case")
    }
    // Then
    expect(
      storage.briefs.descendants("study-1").every((entry) => entry.status === "outdated"),
    ).toBe(true)
    expect(storage.workflow.getPublication(graph.publication.id)).not.toBeNull()
    expect(() =>
      storage.workflow.appendPublication({
        record: { ...graph.publication, id: "late-publication" },
        parentRevisionId: graph.publication.id,
      }),
    ).toThrow()
    expect(storage.workflow.getAnalysis("analysis-1")?.id).toBe("analysis-1")
  },
)
