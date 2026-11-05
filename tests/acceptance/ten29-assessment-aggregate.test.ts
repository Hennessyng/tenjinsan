import { expect, it } from "vitest"
import { aggregateResults } from "./ten29/assessment-tools-v2/aggregate.ts"
import {
  dummyAdjudicator,
  dummyAssessment,
  dummyCoverage,
  dummySource,
  dummyWorkflow,
  finishDummyPasses,
  finishDummyReferences,
} from "./ten29/assessment-tools-v2/dummy-fixture.ts"
import { digest } from "./ten29/assessment-tools-v2/integrity.ts"
import { evaluationReport } from "./ten29/assessment-tools-v2/report.ts"

it("reports no rates before a blind pass and refuses intake-supplied label overrides", () => {
  const { workflow } = dummyWorkflow(),
    report = aggregateResults(workflow)
  expect(report.status).toBe("NOT RUN")
  expect(report.overall.falseAcceptRate).toBeNull()
  expect(report.overall.falseRejectRate).toBeNull()
  expect(report.overall.constructedNegatives).toBe(2)
  expect(report.humanCorroboration.records).toBe(0)
  expect(() => aggregateResults(workflow, [{ intendedLabel: "faithful" }])).toThrow("sealed")
})
it("keeps D5 unassessed and live readiness separate from offline criteria", () => {
  const report = evaluationReport(null)
  expect(report.calibration).toMatchObject({
    status: "NOT RUN",
    scores: null,
    falseAcceptRate: null,
    falseRejectRate: null,
  })
  expect(report.readiness.prerequisiteForOfflineCompletion).toBe(false)
  expect(report.ticketAccepted).toBe(false)
})
it("reports immutable DUMMY_ONLY primary rates and requires label corroboration/coverage", () => {
  const input = finishDummyPasses(),
    before = aggregateResults(input.workflow).primary
  expect(before.overall).toMatchObject({
    faithful: 2,
    negatives: 2,
    falseAcceptRate: 0,
    falseRejectRate: 0,
  })
  expect(aggregateResults(input.workflow).corroborationComplete).toBe(false)
  finishDummyReferences(input)
  for (const document of input.manifest.documents)
    input.workflow.confirmCoverage(dummyCoverage(input.workflow, document.documentCode))
  const after = aggregateResults(input.workflow)
  expect(after.primary).toEqual(before)
  expect(after.status).toBe("DUMMY CONSTRUCTED-CONTROL ARITHMETIC ONLY")
  expect(after.byFormat["epub"]?.uniqueCandidates).toBe(4)
  expect(after.independentSamples.uniqueCandidates).toBe(4)
  expect(after.noInterRaterReliabilityClaim).toBe(true)
})
it("does not add an unapproved universal zero false-reject threshold", () => {
  const input = dummyWorkflow(),
    target = input.manifest.documents[0]?.candidates[0]?.candidateCode
  if (!target) throw new TypeError("Missing DUMMY_ONLY case")
  finishDummyReferences(finishDummyPasses(input, new Map([[target, false]])))
  for (const document of input.manifest.documents)
    input.workflow.confirmCoverage(dummyCoverage(input.workflow, document.documentCode))
  const report = aggregateResults(input.workflow)
  expect(report.overall).toMatchObject({
    falseRejects: 1,
    falseRejectRate: 0.5,
    missedCriticalNegatives: 0,
  })
  expect(report.rows.find((row) => row.candidateCode === target)?.score?.accepted).toBe(false)
  expect(report.acceptanceRule.falseRejectCutoff).toBeNull()
  expect(report.acceptanceRule.nonCriticalFalseAcceptCutoff).toBeNull()
  expect(report.status).toBe("DUMMY CONSTRUCTED-CONTROL ARITHMETIC ONLY")
})
it("keeps a self-disputed missed negative in primary rates even after different-human adjudication", () => {
  const input = dummyWorkflow(),
    target = input.manifest.documents[0]?.candidates[1]?.candidateCode
  if (!target) throw new TypeError("Missing DUMMY_ONLY negative")
  finishDummyPasses(input, new Map([[target, true]]))
  const before = aggregateResults(input.workflow).primary
  finishDummyReferences(input, new Map([[target, { label: "faithful", critical: false }]]))
  const pending = aggregateResults(input.workflow)
  expect(pending.primary).toEqual(before)
  expect(pending.overall).toMatchObject({
    falseAccepts: 1,
    falseAcceptRate: 0.5,
    missedCriticalNegatives: 1,
  })
  expect(pending.disagreements).toContainEqual({
    candidateCode: target,
    unresolved: true,
    humanFinalLabel: "faithful",
    constructedLabelUnchanged: "negative",
  })
  const reference = input.workflow.snapshot().references.find((row) => row.candidateCode === target)
  if (!reference) throw new TypeError("Missing DUMMY_ONLY dispute")
  const adjudication = {
    kind: "human-adjudication",
    mode: "DUMMY_ONLY",
    packetDigest: input.manifest.packetDigest,
    candidateCode: target,
    humanId: "DUMMY-HUMAN",
    referenceDigest: digest(reference),
    label: "faithful",
    criticalNegative: false,
    humanConfirmedKinds: [],
    retainedOriginalRecord: true,
    originalGroundedReason: "DUMMY_ONLY different-human finding; no original grade rewritten",
    completedAt: "2026-01-01T00:06:00Z",
  }
  expect(() => input.workflow.adjudicate(adjudication)).toThrow("Different")
  expect(() =>
    input.workflow.authorizeAdjudicator({
      ...dummyAdjudicator(input.manifest.packetDigest),
      humanId: "DUMMY-HUMAN",
    }),
  ).toThrow("different")
  expect(() =>
    input.workflow.authorizeAdjudicator({
      ...dummyAdjudicator(input.manifest.packetDigest),
      humanId: "DUMMY-COORDINATOR",
    }),
  ).toThrow("different")
  input.workflow.authorizeAdjudicator(dummyAdjudicator(input.manifest.packetDigest))
  input.workflow.adjudicate({ ...adjudication, humanId: "DUMMY-SECOND-HUMAN" })
  const after = aggregateResults(input.workflow)
  expect(after.primary).toEqual(before)
  expect(after.overall.missedCriticalNegatives).toBe(1)
  expect(after.disagreements[0]?.unresolved).toBe(false)
  expect(after.status).toContain("BLOCKED")
  expect(
    input.workflow.snapshot().assessments.find((row) => row.candidateCode === target)?.rubric
      .dimensionScores["original-support"],
  ).toBe(2)
})
it("needs only one person when nobody disputes the constructed labels", () => {
  const { workflow, manifest } = finishDummyReferences()
  expect(() => workflow.authorizeAdjudicator(dummyAdjudicator(manifest.packetDigest))).toThrow(
    "only for a dispute",
  )
  expect(workflow.snapshot().adjudicator).toBeNull()
})
it("keeps semantic citation support human even when every physical location resolves", () => {
  const input = dummyWorkflow(),
    { workflow, manifest } = input
  manifest.documents.forEach((_, index) => {
    workflow.lockSource(dummySource(manifest, index))
  })
  workflow.release("first")
  const candidate = manifest.documents[0]?.candidates[0]
  if (!candidate) throw new TypeError("Missing DUMMY_ONLY case")
  const assessment = dummyAssessment(workflow, candidate.candidateCode)
  expect(candidate.technical.citationLocationsResolved).toBe(true)
  expect(() =>
    workflow.submitAssessment({ ...assessment, mechanicalProofDigest: "0".repeat(64) }),
  ).toThrow("machine")
  expect(() =>
    workflow.submitAssessment({
      ...assessment,
      rubric: {
        ...assessment.rubric,
        criticalFlags: {
          ...assessment.rubric.criticalFlags,
          "unauthorized-authority-change": true,
        },
      },
    }),
  ).toThrow("machine")
  workflow.submitAssessment({
    ...assessment,
    rubric: {
      ...assessment.rubric,
      criticalFlags: { ...assessment.rubric.criticalFlags, "unresolved-retained-citation": true },
    },
  })
  expect(
    aggregateResults(workflow).rows.find((row) => row.candidateCode === candidate.candidateCode)
      ?.score,
  ).toMatchObject({ total: 14, critical: true, accepted: false })
})
