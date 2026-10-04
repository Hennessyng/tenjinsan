import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AnalysisCacheInput, analysisCacheKey } from "@reading-studio/contracts"
import { afterEach, beforeEach, expect, it } from "vitest"
import { openStorage, type Storage } from "../src/index.ts"
import { completeGraphFixtures } from "./fixtures.ts"

let directory: string
let paths: { readonly databasePath: string; readonly privateDataRoot: string }
let storage: Storage
const graph = completeGraphFixtures()
const definition = {
  id: "interview-1",
  studyId: "study-1",
  analysisRevisionId: "analysis-1",
  contextRevisionId: "context-1",
  groups: [{ id: "group-1", label: { en: "Perspective", ja: "視点" } }],
  steps: [{ groupId: "group-1", purpose: "preference", question: graph.question }],
  shortlist: [graph.question.id],
}
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "interview-storage-"))
  paths = {
    databasePath: join(directory, "test.sqlite"),
    privateDataRoot: join(directory, "private"),
  }
  storage = openStorage(paths)
  storage.sources.createOwner("owner-1")
  storage.sources.appendEdition(graph.edition)
  storage.sources.createStudy({ id: "study-1", ownerId: "owner-1", editionId: graph.edition.id })
  storage.sources.appendNormalization({ record: graph.normalization, parentRevisionId: null })
  storage.workflow.appendAnalysis({
    parentRevisionId: null,
    record: {
      ...graph.analysis,
      cacheKey: analysisCacheKey(AnalysisCacheInput.parse(graph.analysis.cacheInput)),
    },
  })
  storage.interviews.create(definition)
})
afterEach(() => {
  storage.close()
  rmSync(directory, { recursive: true, force: true })
})

it("restores a custom response and its exact question snapshot when storage reopens", () => {
  // Given
  storage.interviews.save({
    studyId: "study-1",
    interviewId: "interview-1",
    answer: {
      questionId: graph.question.id,
      questionRevisionId: graph.question.revisionId,
      kind: "custom",
      text: "Private context 日本語",
    },
  })
  storage.close()
  // When
  storage = openStorage(paths)
  // Then
  expect(storage.interviews.answers("interview-1")).toEqual([
    {
      question: graph.question,
      answer: {
        questionId: graph.question.id,
        questionRevisionId: graph.question.revisionId,
        kind: "custom",
        text: "Private context 日本語",
      },
    },
  ])
})

it("rejects obsolete writes while retaining older snapshots when questions are revised", () => {
  // Given
  const write = { studyId: "study-1", interviewId: "interview-1", answer: graph.submission.answer }
  storage.interviews.save(write)
  storage.interviews.create({
    ...definition,
    id: "interview-2",
    steps: [
      {
        ...definition.steps[0],
        question: {
          ...graph.question,
          revisionId: "question-v2",
          options: [{ id: "new-option", label: { en: "New", ja: "新しい" } }],
        },
      },
    ],
  })
  // When / Then
  expect(() => storage.interviews.save(write)).toThrow("stale interview")
  expect(() => storage.interviews.save({ ...write, interviewId: "interview-2" })).toThrow()
  expect(storage.interviews.answers("interview-1")[0]?.question).toEqual(graph.question)
  expect(storage.interviews.answers("interview-2")).toEqual([])
})

it("excludes private interviews when listing or resolving another owner", () => {
  // Given / When / Then
  expect(storage.interviews.owned("study-1", "other-owner")).toBeNull()
  expect(storage.interviews.listOwned("other-owner")).toEqual([])
  expect(storage.interviews.listOwned("owner-1").map((item) => item.id)).toEqual(["interview-1"])
})
