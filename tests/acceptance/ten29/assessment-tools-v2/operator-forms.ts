import { existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { z } from "zod"
import { sealDelivery } from "./delivery-receipts.ts"
import { digest } from "./integrity.ts"
import { readJson, saveNew } from "./operator-store.ts"
import { CriticalFlags, DimensionScores } from "./rubric-schema.ts"
import type { HumanWorkflow } from "./workflow.ts"
export function deliverRound(
  packetRoot: string,
  workflow: HumanWorkflow,
  round: "first" | "second",
) {
  const state = workflow.snapshot()
  const delivered: string[] = []
  if (!state.released.includes(round)) throw new TypeError("Round is not released by signed locks")
  for (const document of state.manifest.documents.filter((row) => row.round === round)) {
    const bundle = z
      .object({
        documentCode: z.string(),
        candidates: z.array(z.object({ candidateCode: z.string() }).passthrough()),
      })
      .parse(readJson(join(packetRoot, "coordinator", "staged", `${document.documentCode}.json`)))
    const source = state.sources.find((row) => row.documentCode === document.documentCode)
    if (
      !source ||
      bundle.documentCode !== document.documentCode ||
      bundle.candidates.length !== document.candidates.length
    )
      throw new TypeError("Staged document differs")
    if (
      JSON.stringify(bundle.candidates.map((row) => row.candidateCode)) !==
      JSON.stringify(document.candidates.map((row) => row.candidateCode))
    )
      throw new TypeError("Staged candidate order/identity differs")
    for (const candidate of bundle.candidates)
      if (
        digest(candidate) !==
        document.candidates.find((row) => row.candidateCode === candidate.candidateCode)
          ?.contentDigest
      )
        throw new TypeError("Staged candidate differs")
    const target = join(packetRoot, "human", document.documentCode)
    mkdirSync(target, { recursive: true, mode: 0o700 })
    const writeSame = (name: string, value: unknown) => {
      const path = join(target, name)
      if (existsSync(path)) {
        if (digest(readJson(path)) !== digest(value))
          throw new TypeError("Existing delivery differs; preserve and inspect")
        return
      }
      saveNew(path, value)
    }
    writeSame("candidates.json", bundle)
    writeSame("rubric.json", readJson(join(packetRoot, "coordinator", "rubric.json")))
    writeSame("technical-facts.json", {
      meaning: "Read-only mechanical observations, not semantic citation support or identity proof",
      candidates: document.candidates.map((candidate) => ({
        candidateCode: candidate.candidateCode,
        technical: candidate.technical,
      })),
    })
    writeSame("assessment-instructions.json", {
      instruction:
        "One first pass only. Use original parts and your locked source-only questions/answers; record reasons, not an AI/model judgment.",
      chapterDecisions: [
        "faithfully-represented",
        "appropriately-absent",
        "misrepresented",
        "materially-omitted",
        "unresolved",
      ],
      unknownFacts:
        "Machine facts are read-only and limited to their stated evidence scope; report a disputed machine fact rather than changing it. Use unresolved for an undecided human semantic judgment.",
      seededNegativeFlag:
        "The seeded-miss marker is machine-derived after the blind pass against sealed constructed labels. Do not guess hidden labels. Those same-author labels remain provisional until corroborated.",
      machineFacts:
        "Processing and observed synthetic authority flags are read-only from retained mechanical evidence. Citation location resolution is a separate fact; it does NOT establish semantic source support. You must assess material claims, late reversal and citation faithfulness.",
      language:
        "Record actual supplied languages, applicability and reason. Score all7 dimensions0–2; never omit or prorate dimension7.",
      threshold:
        "At least1 each and12/14, subject to critical overrides. This threshold is not an independent truth label.",
      completion:
        "Replace all required nulls with your own record and set wrapper status to HUMAN_COMPLETED. Preserve this first pass even if you later disagree with the dataset author.",
    })
    delivered.push(
      ...[
        "candidates.json",
        "rubric.json",
        "technical-facts.json",
        "assessment-instructions.json",
      ].map((name) => join(target, name)),
    )
    for (const candidate of document.candidates) {
      const response = {
        kind: "human-first-pass",
        mode: state.manifest.mode,
        packetDigest: state.manifest.packetDigest,
        documentCode: document.documentCode,
        candidateCode: candidate.candidateCode,
        contentDigest: candidate.contentDigest,
        humanId: state.enrollment.humanId,
        sourceLockDigest: digest(source),
        mechanicalProofDigest: candidate.technical.evidenceDigest,
        rubric: {
          dimensionScores: Object.fromEntries(
            Object.keys(DimensionScores.shape).map((key) => [key, null]),
          ),
          criticalFlags: Object.fromEntries(
            Object.keys(CriticalFlags.shape).map((key) => [
              key,
              key === "incomplete-included-processing"
                ? candidate.technical.incompleteIncludedProcessing
                : key === "unauthorized-authority-change"
                  ? candidate.technical.unauthorizedAuthorityChange
                  : key === "missed-seeded-critical-negative"
                    ? "post-reference"
                    : null,
            ]),
          ),
          languagesProvided: candidate.languagesProvided,
          enJaApplicability: null,
          languageApplicabilityReason: null,
          chapters: [1, 2, 3, 4].map((partOrdinal) => ({
            partOrdinal,
            decision: null,
            originalGrounding: null,
            reason: null,
          })),
        },
        humanAuthorshipAttestation: null,
        completedAt: null,
      }
      const path = join(target, `${candidate.candidateCode}-response.json`)
      if (!existsSync(path)) saveNew(path, { status: "NOT RUN", response })
    }
  }
  sealDelivery(packetRoot, `round-${round}`, delivered)
  return {
    deliveredDocuments: state.manifest.documents
      .filter((row) => row.round === round)
      .map((row) => row.documentCode),
    note: "Only immutable content redelivered; never overwrite a response",
  }
}
export function laterForms(packetRoot: string, workflow: HumanWorkflow) {
  const state = workflow.snapshot(),
    candidates = state.manifest.documents.flatMap((row) => row.candidates)
  if (state.assessments.length !== candidates.length || !state.primarySnapshot)
    throw new TypeError("Corroboration requires sealed unblinding after all blind first passes")
  const target = join(packetRoot, "human", "corroboration")
  mkdirSync(target, { recursive: true, mode: 0o700 })
  const displays: string[] = []
  for (const assessment of state.assessments) {
    const candidate = candidates.find((row) => row.candidateCode === assessment.candidateCode)
    if (!candidate) throw new TypeError("No sealed construction for first pass")
    const display = join(target, `${assessment.candidateCode}-construction.json`)
    if (!existsSync(display))
      saveNew(display, {
        candidateCode: assessment.candidateCode,
        constructed: candidate.constructed,
        qualification:
          "Same-author provisional construction, not independently established gold. Agree or dispute after checking originals. Primary first-pass rates against this sealed construction never change. A dispute needs a different independent human.",
      })
    displays.push(display)
    const path = join(target, `${assessment.candidateCode}.json`)
    if (existsSync(path)) continue
    saveNew(path, {
      status: "NOT RUN",
      response: {
        kind: "label-corroboration",
        mode: state.manifest.mode,
        packetDigest: state.manifest.packetDigest,
        candidateCode: assessment.candidateCode,
        humanId: state.enrollment.humanId,
        firstPassDigest: digest(assessment),
        constructedLabelDigest: digest(candidate.constructed),
        disposition: null,
        label: null,
        criticalNegative: null,
        humanConfirmedKinds: [],
        originalGroundedReason: null,
        humanAuthorshipAttestation: null,
        completedAt: null,
      },
    })
  }
  sealDelivery(packetRoot, "unblind", displays)
}
