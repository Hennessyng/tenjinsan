import type { aggregateResults } from "./aggregate.ts"
export function evaluationReport(calibration: ReturnType<typeof aggregateResults> | null) {
  const dummy = calibration?.mode === "DUMMY_ONLY"
  return {
    mode: dummy ? "DUMMY_ONLY" : "HUMAN assessment workflow",
    offlineProcessing: {
      status: "MECHANICAL PASS in separately retained frozen evidence",
      independentSemanticMeaning: false,
      newGenerationInThisBatch: "NOT RUN",
    },
    packetAndTooling: { status: "PREPARED; technical review is separate from human grades" },
    calibration: calibration ?? {
      status: "NOT RUN",
      humanAssessor: null,
      scores: null,
      falseAcceptRate: null,
      falseRejectRate: null,
    },
    readiness: { status: "BLOCKED (AC9 deliverable)", prerequisiteForOfflineCompletion: false },
    liveTransport: "NOT RUN; conditional AC10 not triggered",
    liveSemantics: "NOT RUN",
    realModelUnderstanding: "NOT TESTED",
    denominators: calibration?.independentSamples ?? {
      semanticFamilies: 4,
      uniqueCandidates: 31,
      formatViewsAreNotIndependent: true,
    },
    offlineAcceptance:
      calibration?.mode === "HUMAN" &&
      calibration.status ===
        "OFFLINE SINGLE-ASSESSOR CALIBRATION RECORDED — READY FOR ACCEPTANCE REVIEW"
        ? "RECORDED; parent/user final offline acceptance review required, no universal zero-FA/FR cutoff specified"
        : calibration?.overall.missedCriticalNegatives
          ? "BLOCKED: constructed critical negative missed; primary result retained even if labels are disputed"
          : "NOT COMPLETE; HUMAN first passes, label corroboration/dispute resolution and applicability remain",
    ticketAccepted: false,
    rootWideLint: "NON_GREEN / OUT_OF_SCOPE (unchanged)",
    protocolLabelsAreIndependentGoldBeforeCorroboration: false,
    primaryCalibrationBasis:
      "immutable same-author constructed labels and intended criticality, explicitly provisional pending human corroboration",
    corroboration:
      "one assessor agrees/disputes after unblinding; only a different approved independent HUMAN adjudicates a dispute",
    acceptanceSource:
      "AC5 reports FA/FR and disagreements; AC6 per-document >=1 each and >=12/14 plus critical overrides. No new universal zero false-reject/false-accept product threshold.",
    reportAudience: "coordinator/technical report; not the blinded source-first human packet",
  }
}
