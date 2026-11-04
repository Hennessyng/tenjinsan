import { coverageMatchesConstructed } from "./coverage-check.ts"
import { scoreWithEvidence } from "./effective-score.ts"
import { digest } from "./integrity.ts"
import { rate } from "./scoring.ts"
import type { HumanWorkflow } from "./workflow.ts"
export function aggregateResults(workflow: HumanWorkflow, attemptedLabelOverride?: unknown) {
  if (attemptedLabelOverride !== undefined)
    throw new TypeError(
      "Primary calibration labels are sealed in the packet, not supplied at intake",
    )
  const state = workflow.snapshot()
  const rows = state.manifest.documents.flatMap((document) =>
    document.candidates.map((candidate) => {
      const assessment = state.assessments.find(
          (row) => row.candidateCode === candidate.candidateCode,
        ),
        reference = state.references.find((row) => row.candidateCode === candidate.candidateCode),
        adjudication = state.adjudications.find(
          (row) => row.candidateCode === candidate.candidateCode,
        )
      const score = assessment ? scoreWithEvidence(assessment, candidate.technical) : null
      const dispute = reference?.disposition === "dispute"
      const unresolvedDispute = dispute && (!adjudication || adjudication.label === "unresolved")
      const finalLabel =
          adjudication?.label ??
          (reference?.disposition === "agree"
            ? candidate.constructed.label
            : (reference?.label ?? null)),
        finalCritical =
          adjudication?.criticalNegative ??
          (reference?.disposition === "agree"
            ? candidate.constructed.critical
            : (reference?.criticalNegative ?? null))
      const corroborated =
        !!reference &&
        finalLabel === candidate.constructed.label &&
        finalCritical === candidate.constructed.critical &&
        !unresolvedDispute
      return {
        candidateCode: candidate.candidateCode,
        documentCode: document.documentCode,
        family: document.family,
        round: document.round,
        formats: candidate.formats,
        equivalenceDigest: candidate.equivalenceDigest,
        constructed: candidate.constructed,
        score,
        dispute: Boolean(dispute),
        unresolvedDispute: Boolean(unresolvedDispute),
        corroborated,
        humanFinalLabel: finalLabel,
        humanFinalCritical: finalCritical,
        firstPassDigest: assessment ? digest(assessment) : null,
      }
    }),
  )
  const summarize = (selected: typeof rows) => {
    const decided = selected.filter((row) => row.score && !row.score.unresolved),
      negatives = selected.filter((row) => row.constructed.label === "negative"),
      faithful = selected.filter((row) => row.constructed.label === "faithful")
    const falseAccepts = negatives.filter((row) => row.score?.accepted).length,
      falseRejects = faithful.filter(
        (row) => row.score && !row.score.unresolved && !row.score.accepted,
      ).length
    const ratesComplete = selected.length > 0 && decided.length === selected.length
    return {
      uniqueCandidates: selected.length,
      assessed: selected.filter((row) => row.score).length,
      decided: decided.length,
      primaryPending: selected.length - decided.length,
      constructedNegatives: negatives.length,
      constructedFaithful: faithful.length,
      negatives: negatives.length,
      faithful: faithful.length,
      falseAccepts,
      falseRejects,
      falseAcceptRate: ratesComplete ? rate(falseAccepts, negatives.length) : null,
      falseRejectRate: ratesComplete ? rate(falseRejects, faithful.length) : null,
      criticalNegatives: negatives.filter((row) => row.constructed.critical).length,
      missedCriticalNegatives: negatives.filter(
        (row) => row.constructed.critical && row.score?.accepted,
      ).length,
      ratesComplete,
    }
  }
  const overall = summarize(rows),
    byFamily = Object.fromEntries(
      state.manifest.documents.map((document) => [
        document.family,
        summarize(rows.filter((row) => row.documentCode === document.documentCode)),
      ]),
    ),
    byRound = Object.fromEntries(
      ["first", "second"].map((round) => [
        round,
        summarize(rows.filter((row) => row.round === round)),
      ]),
    ),
    byFormat = Object.fromEntries(
      ["epub", "docx", "txt", "pdf"].map((format) => [
        format,
        {
          ...summarize(rows.filter((row) => row.formats.some((value) => value === format))),
          dependentInheritedViews: true,
        },
      ]),
    )
  const coverageComplete =
    state.coverage.length === state.manifest.documents.length &&
    state.manifest.documents.every((document) => {
      const coverage = state.coverage.find((row) => row.documentCode === document.documentCode)
      return (
        !!coverage &&
        (coverageMatchesConstructed(document, coverage) ||
          state.coverageAdjudications.some(
            (row) =>
              row.documentCode === document.documentCode && row.conclusion === "uphold-constructed",
          ))
      )
    })
  const insufficientConstructedCohort = Object.values(byFamily).some(
    (family) => family.negatives === 0 || family.faithful === 0 || family.criticalNegatives === 0,
  )
  const corroborationComplete = rows.every((row) => row.corroborated),
    disputedOrOverturned = rows.some(
      (row) => row.dispute || (row.humanFinalLabel !== null && !row.corroborated),
    )
  const pending =
    !overall.ratesComplete ||
    !corroborationComplete ||
    !coverageComplete ||
    insufficientConstructedCohort
  const status =
    overall.assessed === 0
      ? "NOT RUN"
      : overall.missedCriticalNegatives > 0
        ? "CONSTRUCTED CRITICAL NEGATIVE MISSED — BLOCKED (primary result retained)"
        : pending
          ? "PENDING HUMAN CORROBORATION/COVERAGE OR DISTINCT ADJUDICATION"
          : state.manifest.mode === "DUMMY_ONLY"
            ? "DUMMY CONSTRUCTED-CONTROL ARITHMETIC ONLY"
            : "OFFLINE SINGLE-ASSESSOR CALIBRATION RECORDED — READY FOR ACCEPTANCE REVIEW"
  const labelCommitment = digest(
    state.manifest.documents.flatMap((document) =>
      document.candidates.map((candidate) => ({
        candidateCode: candidate.candidateCode,
        constructed: candidate.constructed,
      })),
    ),
  )
  if (
    state.primarySnapshot &&
    (state.primarySnapshot.constructedLabelsDigest !== labelCommitment ||
      state.primarySnapshot.firstPassesDigest !==
        digest(
          state.manifest.documents.flatMap((document) =>
            document.candidates.map((candidate) =>
              state.assessments.find((row) => row.candidateCode === candidate.candidateCode),
            ),
          ),
        ))
  )
    throw new TypeError("Sealed primary result changed")
  return {
    mode: state.manifest.mode,
    status,
    overall,
    primary: {
      basis:
        "sealed same-author constructed labels and intended criticality; provisional, not independently established gold before human corroboration",
      labelCommitment,
      overall,
      immutableAfterBlindFirstPass: true,
      humanCorroborationChangesPrimaryRates: false,
    },
    byFamily,
    byRound,
    byFormat,
    coverageComplete,
    coverage: state.coverage,
    corroborationComplete,
    humanCorroboration: {
      records: state.references.length,
      labelsCorroborated: rows.filter((row) => row.corroborated).length,
      disputed: rows.filter((row) => row.dispute).length,
      unresolvedDisputes: rows.filter((row) => row.unresolvedDispute).length,
    },
    disputedOrOverturned,
    disagreements: rows
      .filter((row) => row.dispute)
      .map((row) => ({
        candidateCode: row.candidateCode,
        unresolved: row.unresolvedDispute,
        humanFinalLabel: row.humanFinalLabel,
        constructedLabelUnchanged: row.constructed.label,
      })),
    rows,
    independentSamples: {
      semanticFamilies: state.manifest.documents.length,
      uniqueCandidates: rows.length,
      formatViewsAreNotIndependent: true,
    },
    referenceSource:
      "SEALED CONSTRUCTED AUTHOR LABELS (provisional); human corroboration/adjudication reported separately",
    acceptanceRule: {
      perDocument: "AC6: >=1 each, >=12/14, critical overrides",
      criticalSeedMissBlocks: true,
      nonCriticalFalseAcceptCutoff: null,
      falseRejectCutoff: null,
      source:
        "approved-description.md AC5 lines100–106: REPORT rates/disagreements; AC6 lines114–125: per-document rubric and critical failures; frozen POLICY.md57–76,121–127",
      finalOfflineAcceptance:
        "Parent/user review required; no universal zero-FA/FR product threshold is specified",
      overturnedCriticalLabel:
        "Retain primary result and flag control-label validity for parent/reviewer; never relabel away a primary miss or automatically promote this frozen benchmark",
    },
    noInterRaterReliabilityClaim: true,
    noRealModelUnderstandingClaim: true,
  }
}
