import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, expect, it } from "vitest"
import { openStorage, type Storage } from "../src/index.ts"
import { approvalContent, approvalGraph, seedApprovalStorage } from "./approval-fixture.ts"

let storage: Storage
let directory: string
let briefId: string
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "outline-"))
  storage = openStorage({ databasePath: join(directory, "db"), privateDataRoot: directory })
  seedApprovalStorage(storage)
  briefId = storage.briefs.save({
    studyId: "study-1",
    expectedRevisionId: null,
    content: approvalContent,
  }).id
  storage.briefs.decide({ studyId: "study-1", revisionId: briefId, action: "approve" })
})
afterEach(() => {
  storage.close()
  rmSync(directory, { recursive: true, force: true })
})

it("allows lesson enqueue only after approval and cancels queued work after revision", () => {
  // Given
  const first = save()
  storage.execution.appendRun({ ...approvalGraph.run, inputRevisionId: first.id })
  expect(() =>
    storage.execution.appendJob({
      ...approvalGraph.job,
      stage: "lesson",
      inputRevisionId: first.id,
    }),
  ).toThrow()
  storage.outlines.decide({ studyId: "study-1", revisionId: first.id, action: "approve" })
  storage.execution.appendJob({ ...approvalGraph.job, stage: "lesson", inputRevisionId: first.id })
  save(first.id)
  // When
  const claimed = storage.execution.claimNextJob({
    token: "outline-lease",
    now: "2026-09-23T01:00:00Z",
    expiresAt: "2026-09-23T01:01:00Z",
  })
  // Then
  expect(claimed).toBeNull()
})

function save(expectedRevisionId: string | null = null) {
  return storage.outlines.save({
    studyId: "study-1",
    briefRevisionId: briefId,
    expectedRevisionId,
    content: {
      title: approvalContent.originalQuestion,
      theme: approvalContent.originalQuestion,
      sections: approvalGraph.outline.sections.map((section) => ({
        ...section,
        questionIndex: 0,
        visualIntents: [{ en: "Illustrative comparison", ja: "比較の例" }],
        visualKind: "illustrative-model",
        flags: [],
      })),
      qualifications: approvalGraph.analysis.qualifications,
      excludedAreas: approvalContent.exclusions,
    },
    feedback: null,
  })
}

it("accepts the last supporting-question index but flags the next index", () => {
  // Given
  const first = save()
  // When
  const last = storage.outlines.save({
    studyId: "study-1",
    briefRevisionId: briefId,
    expectedRevisionId: first.id,
    feedback: null,
    content: {
      ...first.content,
      sections: first.content.sections.map((section) => ({
        ...section,
        questionIndex: approvalContent.supportingQuestions.length,
      })),
    },
  })
  const beyond = storage.outlines.save({
    studyId: "study-1",
    briefRevisionId: briefId,
    expectedRevisionId: last.id,
    feedback: null,
    content: {
      ...last.content,
      sections: last.content.sections.map((section) => ({
        ...section,
        questionIndex: approvalContent.supportingQuestions.length + 1,
      })),
    },
  })
  // Then
  expect(last.content.sections[0]?.flags).toEqual([])
  expect(beyond.content.sections[0]?.flags).toEqual(["irrelevant-section"])
})

it("requires explicit exact outline approval before section eligibility", () => {
  // Given
  const draft = save()
  expect(storage.outlines.approved(draft.id)).toBeNull()
  // When
  storage.outlines.decide({ studyId: "study-1", revisionId: draft.id, action: "approve" })
  // Then
  expect(storage.outlines.approved(draft.id)?.id).toBe(draft.id)
  expect(storage.counts()).toMatchObject({ outlines: 1, lessons: 0, jobs: 0 })
})

it("invalidates approval and rejects stale decisions when outline changes", () => {
  // Given
  const first = save()
  storage.outlines.decide({ studyId: "study-1", revisionId: first.id, action: "approve" })
  // When
  const second = save(first.id)
  // Then
  expect(storage.outlines.approved(first.id)).toBeNull()
  expect(storage.outlines.approved(second.id)).toBeNull()
  expect(() =>
    storage.outlines.decide({ studyId: "study-1", revisionId: first.id, action: "approve" }),
  ).toThrow()
})

it("rejects draft generation when the brief approval is withdrawn", () => {
  // Given
  storage.briefs.decide({ studyId: "study-1", revisionId: briefId, action: "revise" })
  // When / Then
  expect(() => save()).toThrow("brief approval")
})

it("flags irrelevant sections and unsupported visual claims before approval", () => {
  // Given
  const first = save()
  // When
  const flagged = storage.outlines.save({
    studyId: "study-1",
    briefRevisionId: briefId,
    expectedRevisionId: first.id,
    feedback: null,
    content: {
      ...first.content,
      sections: first.content.sections.map((section) => ({
        ...section,
        questionIndex: 99,
        visualKind: "source-grounded",
        visualEvidence: [],
      })),
    },
  })
  // Then
  expect(flagged.content.sections[0]?.flags).toEqual(["irrelevant-section", "unsupported-visual"])
  expect(() =>
    storage.outlines.decide({ studyId: "study-1", revisionId: flagged.id, action: "approve" }),
  ).toThrow("requires revision")
})

it("rejects evidence not in the approved analysis and dropped exclusions", () => {
  // Given
  const first = save()
  // When / Then
  expect(() =>
    storage.outlines.save({
      studyId: "study-1",
      briefRevisionId: briefId,
      expectedRevisionId: first.id,
      feedback: null,
      content: {
        ...first.content,
        sections: first.content.sections.map((section) => ({
          ...section,
          sources: section.sources.map((source) => ({ ...source, blockId: "invented" })),
        })),
      },
    }),
  ).toThrow("evidence outside")
  expect(() =>
    storage.outlines.save({
      studyId: "study-1",
      briefRevisionId: briefId,
      expectedRevisionId: first.id,
      feedback: null,
      content: { ...first.content, excludedAreas: [] },
    }),
  ).toThrow("retained qualifications")
})

it("persists approved outline after database reopen", () => {
  // Given
  const first = save()
  storage.outlines.decide({ studyId: "study-1", revisionId: first.id, action: "approve" })
  // When
  storage.close()
  storage = openStorage({ databasePath: join(directory, "db"), privateDataRoot: directory })
  // Then
  expect(storage.outlines.approved(first.id)?.sections).toHaveLength(first.content.sections.length)
  expect(storage.outlines.current("study-1")?.draft.content).toEqual(first.content)
})

it("rejects lesson writes and enqueue after approved outline changes", () => {
  // Given
  const first = save()
  storage.outlines.decide({ studyId: "study-1", revisionId: first.id, action: "approve" })
  save(first.id)
  storage.execution.appendRun({ ...approvalGraph.run, inputRevisionId: first.id })
  // When / Then
  expect(() =>
    storage.workflow.appendLesson({
      parentRevisionId: null,
      record: {
        ...approvalGraph.lesson,
        briefRevisionId: briefId,
        outlineRevisionId: first.id,
      },
    }),
  ).toThrow()
  expect(() =>
    storage.execution.appendJob({
      ...approvalGraph.job,
      stage: "lesson",
      inputRevisionId: first.id,
    }),
  ).toThrow()
})
