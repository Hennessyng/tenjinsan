import { z } from "zod"
import { digest, openSealed } from "./integrity.ts"
import type { HumanWorkflow } from "./workflow.ts"

const Event = z.strictObject({
  kind: z.enum([
    "source",
    "release",
    "assessment",
    "tuning",
    "reference",
    "adjudication",
    "coverage",
    "unblind",
    "adjudicator",
    "coverage-adjudication",
  ]),
  previousDigest: z.string(),
  packetDigest: z.string(),
  humanId: z.string(),
  mode: z.string(),
  body: z.unknown(),
})
export function replayInto(workflow: HumanWorkflow, input: unknown, key: Buffer) {
  if (workflow.snapshot().journal.length) throw new TypeError("Replay needs empty workflow")
  for (const row of z.array(z.unknown()).parse(input)) {
    const event = Event.parse(openSealed(row, key)),
      state = workflow.snapshot()
    if (
      event.packetDigest !== state.manifest.packetDigest ||
      event.mode !== state.enrollment.mode ||
      event.humanId !== state.enrollment.humanId
    )
      throw new TypeError("Wrong actor/packet/mode")
    if (event.previousDigest !== digest(state.journal.at(-1) ?? null))
      throw new TypeError("Journal chain differs")
    switch (event.kind) {
      case "source":
        workflow.lockSource(event.body)
        break
      case "release":
        workflow.release(z.object({ round: z.enum(["first", "second"]) }).parse(event.body).round)
        break
      case "assessment":
        workflow.submitAssessment(event.body)
        break
      case "tuning":
        workflow.finishTuning(event.body)
        break
      case "reference":
        workflow.submitReference(event.body)
        break
      case "unblind":
        workflow.unblind()
        break
      case "adjudicator":
        workflow.authorizeAdjudicator(event.body)
        break
      case "coverage-adjudication":
        workflow.adjudicateCoverage(event.body)
        break
      case "adjudication":
        workflow.adjudicate(event.body)
        break
      case "coverage":
        workflow.confirmCoverage(event.body)
        break
      default: {
        const impossible: never = event.kind
        throw new TypeError(String(impossible))
      }
    }
    if (digest(workflow.snapshot().journal.at(-1)) !== digest(row))
      throw new TypeError("Receipt replay differs")
  }
}
