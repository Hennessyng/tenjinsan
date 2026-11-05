import { z } from "zod"
import { aggregateResults } from "./aggregate.ts"
import { requireDelivery } from "./delivery-receipts.ts"
import { deliverRound, laterForms } from "./operator-forms.ts"
import {
  enroll,
  loadWorkflow,
  persistEvent,
  readHumanResponse,
  readJson,
} from "./operator-store.ts"
import { preparePostForm } from "./post-forms.ts"
import { evaluationReport } from "./report.ts"
import { AdjudicatorEnrollment } from "./workflow-schema.ts"

const [packetRoot, action, argument] = process.argv.slice(2)
try {
  if (!packetRoot || !action)
    throw new TypeError("Usage: operator.ts packetRoot action [file-or-round]")
  if (action === "enroll") {
    if (!argument) throw new TypeError("Explicit user-approved authorization file required")
    enroll(packetRoot, argument)
    console.log("Enrollment recorded from explicit operator authorization")
  } else {
    const workflow = loadWorkflow(packetRoot)
    switch (action) {
      case "lock-source":
      case "assess":
      case "finish-tuning":
      case "reference":
      case "adjudicate":
      case "coverage": {
        if (!argument) throw new TypeError("Completed HUMAN response file required")
        const input = readHumanResponse(argument)
        if (action === "assess") {
          const code = z.object({ documentCode: z.string() }).parse(input).documentCode,
            document = workflow
              .snapshot()
              .manifest.documents.find((row) => row.documentCode === code)
          if (!document) throw new TypeError("Unknown document")
          requireDelivery(packetRoot, `round-${document.round}`)
        }
        if (action === "reference") requireDelivery(packetRoot, "unblind")
        if (action === "adjudicate")
          requireDelivery(
            packetRoot,
            `adjudication-${z.object({ candidateCode: z.string() }).parse(input).candidateCode}`,
          )
        const receipt =
          action === "lock-source"
            ? workflow.lockSource(input)
            : action === "assess"
              ? workflow.submitAssessment(input)
              : action === "finish-tuning"
                ? workflow.finishTuning(input)
                : action === "reference"
                  ? workflow.submitReference(input)
                  : action === "adjudicate"
                    ? workflow.adjudicate(input)
                    : workflow.confirmCoverage(input)
        persistEvent(packetRoot, workflow, receipt)
        console.log(
          JSON.stringify({
            event: action,
            receipt: receipt.mac,
            sourceLocks: workflow.snapshot().sources.length,
            firstPasses: workflow.snapshot().assessments.length,
          }),
        )
        break
      }
      case "release": {
        const round = z.enum(["first", "second"]).parse(argument)
        persistEvent(packetRoot, workflow, workflow.release(round))
        console.log(JSON.stringify(deliverRound(packetRoot, workflow, round)))
        break
      }
      case "resume-delivery":
        console.log(
          JSON.stringify(
            deliverRound(packetRoot, workflow, z.enum(["first", "second"]).parse(argument)),
          ),
        )
        break
      case "reference-forms":
        laterForms(packetRoot, workflow)
        console.log(
          "Unblinded construction and blank corroboration forms restored after sealed blind pass",
        )
        break
      case "unblind": {
        persistEvent(packetRoot, workflow, workflow.unblind())
        laterForms(packetRoot, workflow)
        console.log(
          "Primary blind-pass commitments sealed; constructed labels shown for agree/dispute",
        )
        break
      }
      case "resume-unblind":
        laterForms(packetRoot, workflow)
        console.log("Same unblinded construction/forms restored; never another first pass")
        break
      case "enroll-adjudicator": {
        if (!argument) throw new TypeError("Explicit different-human authorization file required")
        const approved = z
          .strictObject({
            status: z.literal("ADJUDICATOR_AUTHORIZED"),
            authorization: AdjudicatorEnrollment,
          })
          .parse(readJson(argument))
        persistEvent(packetRoot, workflow, workflow.authorizeAdjudicator(approved.authorization))
        console.log(
          "Different approved human recorded for an existing dispute; not identity verification",
        )
        break
      }
      case "coverage-adjudicate": {
        if (!argument) throw new TypeError("Different-human completed response required")
        const response = readHumanResponse(argument)
        requireDelivery(
          packetRoot,
          `coverage-${z.object({ documentCode: z.string() }).parse(response).documentCode}`,
        )
        persistEvent(packetRoot, workflow, workflow.adjudicateCoverage(response))
        console.log("Different-human applicability adjudication retained")
        break
      }
      case "forms": {
        const [kind, code] = (argument ?? "").split(":")
        const form = z
          .enum([
            "finish-tuning",
            "references",
            "adjudication",
            "coverage",
            "coverage-adjudication",
          ])
          .parse(kind)
        preparePostForm(packetRoot, workflow, { action: form, ...(code ? { code } : {}) })
        console.log(
          "Later-stage form prepared only behind its gate; no human responses or grades filled",
        )
        break
      }
      case "report": {
        console.log(JSON.stringify(evaluationReport(aggregateResults(workflow)), null, 2))
        break
      }
      default:
        throw new TypeError("Unknown offline operator command")
    }
  }
} catch (error) {
  console.error(
    error instanceof Error
      ? `Offline operation refused (${error.name}); preserve files and inspect coordinator evidence.`
      : "Offline operation refused",
  )
  process.exitCode = 1
}
