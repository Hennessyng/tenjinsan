import { existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { z } from "zod"
import { CoverageKind } from "./coverage-schema.ts"
import { sealDelivery } from "./delivery-receipts.ts"
import { digest } from "./integrity.ts"
import { laterForms } from "./operator-forms.ts"
import { readJson, saveNew } from "./operator-store.ts"
import type { HumanWorkflow } from "./workflow.ts"
export function preparePostForm(
  packetRoot: string,
  workflow: HumanWorkflow,
  request: {
    readonly action:
      | "finish-tuning"
      | "references"
      | "adjudication"
      | "coverage"
      | "coverage-adjudication"
    readonly code?: string
  },
) {
  const state = workflow.snapshot(),
    target = join(packetRoot, "human", "post-forms")
  mkdirSync(target, { recursive: true, mode: 0o700 })
  const common = {
    mode: state.manifest.mode,
    packetDigest: state.manifest.packetDigest,
    humanId: state.enrollment.humanId,
  }
  const save = (name: string, response: unknown) => {
    const path = join(target, name)
    if (!existsSync(path)) saveNew(path, { status: "NOT RUN", response })
  }
  switch (request.action) {
    case "finish-tuning": {
      const first = state.manifest.documents
        .filter((row) => row.round === "first")
        .flatMap((row) => row.candidates)
      if (
        !state.released.includes("first") ||
        first.some(
          (row) => !state.assessments.some((record) => record.candidateCode === row.candidateCode),
        )
      )
        throw new TypeError("First administrative round incomplete")
      save("workflow-note.json", {
        kind: "tuning-complete",
        ...common,
        noProtocolChange: null,
        reason: null,
        completedAt: null,
      })
      break
    }
    case "references":
      laterForms(packetRoot, workflow)
      break
    case "adjudication": {
      const reference = state.references.find((row) => row.candidateCode === request.code)
      const document = state.manifest.documents.find((row) =>
        row.candidates.some((candidate) => candidate.candidateCode === request.code),
      )
      if (!reference || reference.disposition !== "dispute" || !state.adjudicator || !document)
        throw new TypeError("Only a named different independent human may adjudicate a dispute")
      const secondary = join(packetRoot, "adjudicator", reference.candidateCode)
      mkdirSync(secondary, { recursive: true, mode: 0o700 })
      const supply = (name: string, value: unknown) => {
        const path = join(secondary, name)
        if (!existsSync(path)) saveNew(path, value)
      }
      const bundle = z
        .object({ candidates: z.array(z.object({ candidateCode: z.string() }).passthrough()) })
        .parse(readJson(join(packetRoot, "coordinator", "staged", `${document.documentCode}.json`)))
      supply("source.json", readJson(join(packetRoot, "human", `${document.documentCode}.json`)))
      supply(
        "candidate.json",
        bundle.candidates.find((candidate) => candidate.candidateCode === reference.candidateCode),
      )
      supply("construction-and-dispute.json", {
        constructed: document.candidates.find(
          (candidate) => candidate.candidateCode === reference.candidateCode,
        )?.constructed,
        assessorDispute: reference.originalGroundedReason,
        proposedLabel: reference.label,
        proposedCriticality: reference.criticalNegative,
        note: "Provisional author construction; check originals independently. Primary blind-pass rates cannot change. No AI assistance; signing is not identity proof.",
      })
      supply("response.json", {
        status: "NOT RUN",
        response: {
          kind: "human-adjudication",
          ...common,
          humanId: state.adjudicator.humanId,
          candidateCode: reference.candidateCode,
          referenceDigest: digest(reference),
          label: null,
          criticalNegative: null,
          humanConfirmedKinds: [],
          retainedOriginalRecord: null,
          originalGroundedReason: null,
          completedAt: null,
        },
      })
      sealDelivery(
        packetRoot,
        `adjudication-${reference.candidateCode}`,
        ["source.json", "candidate.json", "construction-and-dispute.json"].map((name) =>
          join(secondary, name),
        ),
      )
      break
    }
    case "coverage-adjudication": {
      const coverage = state.coverage.find((row) => row.documentCode === request.code)
      if (!coverage || !state.adjudicator)
        throw new TypeError(
          "Named different adjudicator and recorded applicability dispute required",
        )
      const directory = join(packetRoot, "adjudicator", coverage.documentCode)
      mkdirSync(directory, { recursive: true, mode: 0o700 })
      const path = join(directory, "coverage-response.json")
      const source = join(directory, "source.json"),
        issue = join(directory, "coverage-dispute.json"),
        document = state.manifest.documents.find(
          (row) => row.documentCode === coverage.documentCode,
        )
      if (!document) throw new TypeError("No source document for applicability dispute")
      if (!existsSync(source))
        saveNew(source, readJson(join(packetRoot, "human", `${document.documentCode}.json`)))
      if (!existsSync(issue))
        saveNew(issue, {
          coverage,
          constructedInapplicableKinds: document.constructedInapplicableKinds,
          constructedCandidates: document.candidates.map((candidate) => ({
            candidateCode: candidate.candidateCode,
            constructed: candidate.constructed,
          })),
          note: "Provisional construction; primary calibration remains unchanged. Different independent human only, no AI assistance.",
        })
      if (!existsSync(path))
        saveNew(path, {
          status: "NOT RUN",
          response: {
            kind: "coverage-adjudication",
            ...common,
            humanId: state.adjudicator.humanId,
            documentCode: coverage.documentCode,
            coverageDigest: digest(coverage),
            conclusion: null,
            originalGroundedReason: null,
            completedAt: null,
          },
        })
      sealDelivery(packetRoot, `coverage-${coverage.documentCode}`, [source, issue])
      break
    }
    case "coverage": {
      const document = state.manifest.documents.find((row) => row.documentCode === request.code)
      if (
        !document ||
        document.candidates.some(
          (candidate) =>
            !state.references.some((row) => row.candidateCode === candidate.candidateCode),
        )
      )
        throw new TypeError("Independent references incomplete")
      const referenceSetDigest = digest(
        document.candidates.map((candidate) => ({
          reference: state.references.find((row) => row.candidateCode === candidate.candidateCode),
          adjudication:
            state.adjudications.find((row) => row.candidateCode === candidate.candidateCode) ??
            null,
        })),
      )
      save(`${document.documentCode}-coverage-${referenceSetDigest.slice(0, 12)}.json`, {
        kind: "human-critical-coverage",
        ...common,
        documentCode: document.documentCode,
        referenceSetDigest,
        rows: CoverageKind.options.map((kind) => ({
          kind,
          applicability: null,
          candidateCodes: [],
          originalGroundedReason: null,
        })),
        humanAuthorshipAttestation: null,
        completedAt: null,
      })
      break
    }
    default: {
      const impossible: never = request.action
      throw new TypeError(String(impossible))
    }
  }
}
