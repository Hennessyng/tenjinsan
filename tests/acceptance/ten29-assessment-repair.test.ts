import { expect, it } from "vitest"
import { aggregateResults } from "./ten29/assessment-tools-v2/aggregate.ts"
import {
  dummyAdjudicator,
  dummyAssessment,
  dummySource,
  dummyTuning,
  dummyWorkflow,
  finishDummyPasses,
  finishDummyReferences,
} from "./ten29/assessment-tools-v2/dummy-fixture.ts"
import { digest } from "./ten29/assessment-tools-v2/integrity.ts"

function missedDummy() {
  const input = dummyWorkflow(),
    { workflow, manifest } = input
  for (const [index] of manifest.documents.entries())
    workflow.lockSource(dummySource(manifest, index))
  for (const round of ["first", "second"] as const) {
    workflow.release(round)
    for (const document of manifest.documents.filter((row) => row.round === round))
      for (const [index, candidate] of document.candidates.entries())
        workflow.submitAssessment(
          dummyAssessment(workflow, candidate.candidateCode, round === "first" || index === 0),
        )
    if (round === "first") workflow.finishTuning(dummyTuning(manifest.packetDigest))
  }
  return finishDummyReferences(input)
}
it("keeps a missed DUMMY_ONLY constructed negative in primary rates before and after corroboration", () => {
  const input = missedDummy()
  expect(aggregateResults(input.workflow).overall.falseAccepts).toBe(1)
})
it("does not let the same DUMMY_ONLY assessor relabel or adjudicate their own missed negative", () => {
  const { workflow, manifest } = missedDummy(),
    code = manifest.documents[0]?.candidates[1]?.candidateCode
  const reference = workflow.snapshot().references.find((row) => row.candidateCode === code)
  if (!reference) throw new TypeError("Missing DUMMY_ONLY reference")
  expect(() =>
    workflow.adjudicate({
      kind: "human-adjudication",
      mode: "DUMMY_ONLY",
      packetDigest: manifest.packetDigest,
      candidateCode: code,
      humanId: "DUMMY-HUMAN",
      referenceDigest: digest(reference),
      label: "faithful",
      criticalNegative: false,
      humanConfirmedKinds: [],
      retainedOriginalRecord: true,
      originalGroundedReason: "DUMMY_ONLY relabel attempt",
      completedAt: "2026-01-01T00:06:00Z",
    }),
  ).toThrow()
})
it("binds corroboration to a sealed unblind event and unchanged constructed label", () => {
  const { workflow, manifest } = finishDummyPasses(),
    firstPass = workflow.snapshot().assessments[0],
    candidate = manifest.documents[0]?.candidates[0]
  if (!firstPass || !candidate) throw new TypeError("Missing DUMMY_ONLY case")
  const record = {
    kind: "label-corroboration",
    mode: "DUMMY_ONLY",
    packetDigest: manifest.packetDigest,
    candidateCode: candidate.candidateCode,
    humanId: "DUMMY-HUMAN",
    firstPassDigest: digest(firstPass),
    constructedLabelDigest: digest(candidate.constructed),
    disposition: "agree",
    label: null,
    criticalNegative: null,
    humanConfirmedKinds: [],
    originalGroundedReason: "DUMMY_ONLY",
    humanAuthorshipAttestation: true,
    completedAt: "2026-01-01T00:05:00Z",
  }
  expect(() => workflow.submitReference(record)).toThrow("unblinded")
  workflow.unblind()
  expect(() => workflow.unblind()).toThrow("Unblinding")
  expect(() =>
    workflow.submitReference({ ...record, constructedLabelDigest: "0".repeat(64) }),
  ).toThrow("sealed")
  expect(() =>
    workflow.submitReference({
      ...record,
      disposition: "agree",
      label: "negative",
      criticalNegative: true,
    }),
  ).toThrow()
  workflow.submitReference(record)
  expect(() => workflow.submitReference(record)).toThrow()
})
it("rejects weak, foreign and same-person secondary authority", () => {
  const input = dummyWorkflow(),
    target = input.manifest.documents[0]?.candidates[1]?.candidateCode
  if (!target) throw new TypeError("Missing DUMMY_ONLY negative")
  finishDummyReferences(
    finishDummyPasses(input),
    new Map([[target, { label: "faithful", critical: false }]]),
  )
  expect(() =>
    input.workflow.authorizeAdjudicator({
      ...dummyAdjudicator(input.manifest.packetDigest),
      didNotEvaluateFirstPass: false,
    }),
  ).toThrow()
  expect(() =>
    input.workflow.authorizeAdjudicator({
      ...dummyAdjudicator(input.manifest.packetDigest),
      packetDigest: "0".repeat(64),
    }),
  ).toThrow()
  expect(() =>
    input.workflow.authorizeAdjudicator({
      ...dummyAdjudicator(input.manifest.packetDigest),
      humanId: input.enrollment.coordinatorId,
    }),
  ).toThrow("different")
  input.workflow.authorizeAdjudicator(dummyAdjudicator(input.manifest.packetDigest))
  const reference = input.workflow.snapshot().references.find((row) => row.candidateCode === target)
  if (!reference) throw new TypeError("Missing DUMMY_ONLY dispute")
  const record = {
    kind: "human-adjudication",
    mode: "DUMMY_ONLY",
    packetDigest: input.manifest.packetDigest,
    candidateCode: target,
    humanId: "DUMMY-SECOND-HUMAN",
    referenceDigest: digest(reference),
    label: "negative",
    criticalNegative: true,
    humanConfirmedKinds: ["unsupported-overstated"],
    retainedOriginalRecord: true,
    originalGroundedReason: "DUMMY_ONLY",
    completedAt: "2026-01-01T00:06:00Z",
  }
  expect(() => input.workflow.adjudicate({ ...record, referenceDigest: "0".repeat(64) })).toThrow()
  expect(() => input.workflow.adjudicate({ ...record, humanId: "DUMMY-HUMAN" })).toThrow(
    "Different",
  )
  input.workflow.adjudicate(record)
  expect(() => input.workflow.adjudicate(record)).toThrow("duplicate")
})
