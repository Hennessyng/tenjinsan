import { expect, it } from "vitest"
import {
  dummyAssessment,
  dummySource,
  dummyTuning,
  dummyWorkflow,
  finishDummyPasses,
} from "./ten29/assessment-tools-v2/dummy-fixture.ts"
import { digest } from "./ten29/assessment-tools-v2/integrity.ts"
import { HumanWorkflow } from "./ten29/assessment-tools-v2/workflow.ts"

it("keeps candidates closed when no named authority or source locks exist", () => {
  const input = dummyWorkflow()
  expect(
    () => new HumanWorkflow({ ...input, enrollment: { ...input.enrollment, humanId: null } }),
  ).toThrow()
  expect(() => input.workflow.release("first")).toThrow("lock")
  expect(() => input.workflow.release("second")).toThrow("lock")
})
it.each(["question", "independentlyAuthoredAnswer", "materialContribution", "originalGrounding"])(
  "rejects empty DUMMY_ONLY source field %s",
  (key) => {
    const { workflow, manifest } = dummyWorkflow(),
      source = dummySource(manifest)
    expect(() =>
      workflow.lockSource({
        ...source,
        chapters: source.chapters.map((row) => ({ ...row, [key]: "" })),
      }),
    ).toThrow()
  },
)
it("requires cross-book answers and four unique source chapters before locking", () => {
  const { workflow, manifest } = dummyWorkflow(),
    source = dummySource(manifest)
  expect(() => workflow.lockSource({ ...source, crossBookQuestionsAndAnswers: [] })).toThrow()
  expect(() =>
    workflow.lockSource({ ...source, chapters: source.chapters.map(() => source.chapters[0]) }),
  ).toThrow()
})
it("rejects a source record from another document or authority", () => {
  const { workflow, manifest } = dummyWorkflow(),
    source = dummySource(manifest)
  expect(() => workflow.lockSource({ ...source, humanId: "OTHER" })).toThrow("actor")
  expect(() => workflow.lockSource({ ...source, sourceDigest: "f".repeat(64) })).toThrow("source")
})
it("locks every document before first exposure and cannot revise a locked source", () => {
  const { workflow, manifest } = dummyWorkflow()
  workflow.lockSource(dummySource(manifest))
  expect(() => workflow.release("first")).toThrow("lock")
  workflow.lockSource(dummySource(manifest, 1))
  workflow.release("first")
  expect(() => workflow.lockSource(dummySource(manifest))).toThrow("source")
})
it("rejects wrong candidate, question lock, actor and incomplete flags in DUMMY_ONLY first pass", () => {
  const { workflow, manifest } = dummyWorkflow()
  manifest.documents.forEach((_, index) => {
    workflow.lockSource(dummySource(manifest, index))
  })
  workflow.release("first")
  const candidate = manifest.documents[0]?.candidates[0]
  if (!candidate) throw new TypeError("Missing DUMMY_ONLY candidate")
  const assessment = dummyAssessment(workflow, candidate.candidateCode)
  for (const mutation of [
    { sourceLockDigest: "f".repeat(64) },
    { contentDigest: "f".repeat(64) },
    { candidateCode: `C-${"f".repeat(24)}` },
    { humanId: "OTHER" },
    { mode: "HUMAN" },
    { rubric: { ...assessment.rubric, criticalFlags: {} } },
  ])
    expect(() => workflow.submitAssessment({ ...assessment, ...mutation })).toThrow()
  workflow.submitAssessment(assessment)
  expect(() => workflow.submitAssessment(assessment)).toThrow("duplicate")
})
it("prevents held-out exposure and protocol-change shortcuts before completed tuning", () => {
  const { workflow, manifest } = dummyWorkflow()
  manifest.documents.forEach((_, index) => {
    workflow.lockSource(dummySource(manifest, index))
  })
  workflow.release("first")
  expect(() => workflow.release("second")).toThrow("tuning")
  expect(() => workflow.finishTuning(dummyTuning(manifest.packetDigest))).toThrow("Tuning")
  for (const candidate of manifest.documents[0]?.candidates ?? [])
    workflow.submitAssessment(dummyAssessment(workflow, candidate.candidateCode))
  expect(() =>
    workflow.finishTuning({ ...dummyTuning(manifest.packetDigest), noProtocolChange: false }),
  ).toThrow()
  workflow.finishTuning(dummyTuning(manifest.packetDigest))
  workflow.release("second")
  const candidate = manifest.documents[1]?.candidates[0]
  if (!candidate) throw new TypeError("Missing DUMMY_ONLY candidate")
  expect(() =>
    workflow.submitAssessment({
      ...dummyAssessment(workflow, candidate.candidateCode),
      completedAt: "2026-01-01T00:02:00Z",
    }),
  ).toThrow("precedes")
})
it("verifies signed chained receipts and rejects forged or reordered assessment history", () => {
  const input = finishDummyPasses(),
    journal = input.workflow.snapshot().journal
  const restored = new HumanWorkflow(input)
  restored.replay(journal)
  expect(restored.snapshot().assessments).toHaveLength(4)
  const forged = journal.map((row, index) =>
    index === journal.length - 1
      ? { ...row, payload: row.payload.replace("DUMMY-HUMAN", "FORGED-HUMAN") }
      : row,
  )
  expect(() => new HumanWorkflow(input).replay(forged)).toThrow("Forged")
  expect(() => new HumanWorkflow(input).replay([...journal].reverse())).toThrow("chain")
  expect(() => new HumanWorkflow(input).replay([...journal, journal.at(-1)])).toThrow()
  expect(digest(restored.snapshot().journal)).toBe(digest(journal))
})
