import { CoverageKind } from "./coverage-schema.ts"
import { dummyRubric } from "./dummy-rubric.ts"
import { digest } from "./integrity.ts"
import { HumanWorkflow } from "./workflow.ts"
import { Enrollment, Manifest } from "./workflow-schema.ts"

export { dummyRubric } from "./dummy-rubric.ts"
export function dummyWorkflow() {
  const body = {
    version: "TEN29-human-packet-3",
    mode: "DUMMY_ONLY",
    documents: [1, 2].map((index) => ({
      documentCode: `D-${String(index).repeat(24)}`,
      sourceDigest: "a".repeat(64),
      family: `DUMMY-FAMILY-${index}`,
      round: index === 1 ? "first" : "second",
      constructedInapplicableKinds: CoverageKind.options.filter(
        (kind) => kind !== "unsupported-overstated",
      ),
      candidates: [1, 2].map((candidate) => ({
        candidateCode: `C-${String((index - 1) * 2 + candidate).repeat(24)}`,
        contentDigest: "b".repeat(64),
        languagesProvided: ["en"],
        formats: ["epub", "docx", "txt", "pdf"],
        equivalenceDigest: "e".repeat(64),
        constructed: {
          label: candidate === 1 ? "faithful" : "negative",
          critical: candidate !== 1,
          kind: candidate === 1 ? null : "unsupported-overstated",
          authorReason: "DUMMY_ONLY constructed expectation, not semantic truth",
          status: "PROVISIONAL SAME-AUTHOR CONSTRUCTION",
        },
        technical: {
          evidenceDigest: "f".repeat(64),
          incompleteIncludedProcessing: false,
          unauthorizedAuthorityChange: false,
          citationLocationsResolved: true,
          scope: "DUMMY_ONLY simulated evidence, not an actual corpus run",
          semanticCitationSupport: "NOT ASSESSED; human source-faithfulness judgment required",
        },
      })),
    })),
  }
  const manifest = Manifest.parse({ ...body, packetDigest: digest(body) }),
    enrollment = Enrollment.parse({
      mode: "DUMMY_ONLY",
      humanId: "DUMMY-HUMAN",
      packetDigest: manifest.packetDigest,
      approvalReference: "DUMMY_ONLY not user authorization",
      role: "independent-human",
      noAuthorshipOverlap: true,
      exposureDisclosure: "DUMMY_ONLY",
      coordinatorId: "DUMMY-COORDINATOR",
    }),
    key = Buffer.alloc(32, 3)
  return { manifest, enrollment, key, workflow: new HumanWorkflow({ manifest, enrollment, key }) }
}
export function dummySource(manifest: ReturnType<typeof dummyWorkflow>["manifest"], index = 0) {
  const document = manifest.documents[index]
  if (!document) throw new TypeError("Missing DUMMY_ONLY document")
  return {
    kind: "source-only-record",
    mode: "DUMMY_ONLY",
    packetDigest: manifest.packetDigest,
    documentCode: document.documentCode,
    sourceDigest: document.sourceDigest,
    humanId: "DUMMY-HUMAN",
    exposureAndConflicts: "DUMMY_ONLY",
    sourceOnlyOpenedAt: "2026-01-01T00:00:00Z",
    chapters: [1, 2, 3, 4].map((partOrdinal) => ({
      partOrdinal,
      materialContribution: "DUMMY_ONLY",
      question: "DUMMY_ONLY",
      independentlyAuthoredAnswer: "DUMMY_ONLY",
      originalGrounding: "DUMMY_ONLY",
      uncertainties: "DUMMY_ONLY",
    })),
    crossBookQuestionsAndAnswers: [
      {
        question: "DUMMY_ONLY",
        independentlyAuthoredAnswer: "DUMMY_ONLY",
        originalGrounding: "DUMMY_ONLY",
        partOrdinals: [1, 4],
      },
    ],
    humanAuthorshipAttestation: true,
    lockedBeforeCandidatesAt: "2026-01-01T00:01:00Z",
  }
}
export function dummyAssessment(workflow: HumanWorkflow, code: string, accepted = true) {
  const state = workflow.snapshot(),
    document = state.manifest.documents.find((row) =>
      row.candidates.some((candidate) => candidate.candidateCode === code),
    ),
    candidate = document?.candidates.find((row) => row.candidateCode === code),
    source = state.sources.find((row) => row.documentCode === document?.documentCode)
  if (!document || !candidate || !source) throw new TypeError("Missing DUMMY_ONLY candidate/source")
  return {
    kind: "human-first-pass",
    mode: "DUMMY_ONLY",
    packetDigest: state.manifest.packetDigest,
    documentCode: document.documentCode,
    candidateCode: code,
    contentDigest: candidate.contentDigest,
    humanId: "DUMMY-HUMAN",
    sourceLockDigest: digest(source),
    mechanicalProofDigest: candidate.technical.evidenceDigest,
    rubric: {
      ...dummyRubric,
      criticalFlags: {
        ...dummyRubric.criticalFlags,
        "material-retained-claim-error": !accepted,
        "incomplete-included-processing": candidate.technical.incompleteIncludedProcessing,
        "unauthorized-authority-change": candidate.technical.unauthorizedAuthorityChange,
        "missed-seeded-critical-negative": "post-reference",
      },
    },
    humanAuthorshipAttestation: true,
    completedAt: document.round === "first" ? "2026-01-01T00:02:00Z" : "2026-01-01T00:04:00Z",
  }
}
export const dummyTuning = (packetDigest: string) => ({
  kind: "tuning-complete",
  mode: "DUMMY_ONLY",
  humanId: "DUMMY-HUMAN",
  packetDigest,
  noProtocolChange: true,
  reason: "DUMMY_ONLY",
  completedAt: "2026-01-01T00:03:00Z",
})
export const dummyAdjudicator = (packetDigest: string) => ({
  mode: "DUMMY_ONLY",
  packetDigest,
  humanId: "DUMMY-SECOND-HUMAN",
  role: "independent-adjudicator",
  approvalReference: "DUMMY_ONLY second-person approval",
  noAuthorshipOverlap: true,
  didNotEvaluateFirstPass: true,
  exposureDisclosure: "DUMMY_ONLY",
})
export function finishDummyPasses(
  input = dummyWorkflow(),
  decisions: ReadonlyMap<string, boolean> = new Map(),
) {
  const { workflow, manifest } = input
  for (const [index] of manifest.documents.entries())
    workflow.lockSource(dummySource(manifest, index))
  for (const round of ["first", "second"] as const) {
    workflow.release(round)
    for (const document of manifest.documents.filter((row) => row.round === round))
      for (const [index, candidate] of document.candidates.entries())
        workflow.submitAssessment(
          dummyAssessment(
            workflow,
            candidate.candidateCode,
            decisions.get(candidate.candidateCode) ?? index === 0,
          ),
        )
    if (round === "first") workflow.finishTuning(dummyTuning(manifest.packetDigest))
  }
  return input
}
export function finishDummyReferences(
  input = finishDummyPasses(),
  disputes: ReadonlyMap<
    string,
    { readonly label: "faithful" | "negative" | "unresolved"; readonly critical: boolean | null }
  > = new Map(),
) {
  if (!input.workflow.snapshot().primarySnapshot) input.workflow.unblind()
  const state = input.workflow.snapshot()
  for (const document of state.manifest.documents)
    for (const [index, candidate] of document.candidates.entries()) {
      const assessment = state.assessments.find(
        (row) => row.candidateCode === candidate.candidateCode,
      )
      if (!assessment) throw new TypeError("Missing DUMMY_ONLY first pass")
      const proposal = disputes.get(candidate.candidateCode)
      input.workflow.submitReference({
        kind: "label-corroboration",
        mode: "DUMMY_ONLY",
        packetDigest: state.manifest.packetDigest,
        candidateCode: candidate.candidateCode,
        humanId: "DUMMY-HUMAN",
        firstPassDigest: digest(assessment),
        constructedLabelDigest: digest(candidate.constructed),
        disposition: proposal ? "dispute" : "agree",
        label: proposal?.label ?? null,
        criticalNegative: proposal?.critical ?? null,
        humanConfirmedKinds: index === 0 ? [] : CoverageKind.options,
        originalGroundedReason: "DUMMY_ONLY",
        humanAuthorshipAttestation: true,
        completedAt: "2026-01-01T00:05:00Z",
      })
    }
  return input
}
export function dummyCoverage(workflow: HumanWorkflow, documentCode: string) {
  const state = workflow.snapshot(),
    document = state.manifest.documents.find((row) => row.documentCode === documentCode)
  if (!document) throw new TypeError("Missing DUMMY_ONLY document")
  return {
    kind: "human-critical-coverage",
    mode: "DUMMY_ONLY",
    packetDigest: state.manifest.packetDigest,
    humanId: "DUMMY-HUMAN",
    documentCode,
    referenceSetDigest: digest(
      document.candidates.map((candidate) => ({
        reference: state.references.find((row) => row.candidateCode === candidate.candidateCode),
        adjudication:
          state.adjudications.find((row) => row.candidateCode === candidate.candidateCode) ?? null,
      })),
    ),
    rows: CoverageKind.options.map((kind) => ({
      kind,
      applicability: document.constructedInapplicableKinds.includes(kind)
        ? "not-applicable"
        : "applicable",
      candidateCodes: document.candidates
        .filter((candidate) => candidate.constructed.kind === kind)
        .map((candidate) => candidate.candidateCode),
      originalGroundedReason: "DUMMY_ONLY",
    })),
    humanAuthorshipAttestation: true,
    completedAt: "2026-01-01T00:06:00Z",
  }
}
