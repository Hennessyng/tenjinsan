import {
  assertNever,
  CoverageVerification,
  coverageTargetHash,
  coverageVerificationSchema,
} from "@reading-studio/contracts"
import { BookMapError } from "./book-map-output.ts"
import type { WholeBookContext } from "./whole-book-context.ts"
import { coverageVerificationTargets } from "./whole-book-coverage.ts"

export function completedCoverageVerification(context: WholeBookContext) {
  return coverageVerificationTargets(context).flatMap((target, index) => {
    const output = context.output("verify", coverageVerificationSchema(target), index)
    if (!output) return []
    if (
      !output.verificationTarget ||
      coverageTargetHash(output.verificationTarget) !== coverageTargetHash(target)
    )
      throw new BookMapError("missing-receipt")
    switch (target.kind) {
      case "window":
        if (
          JSON.stringify(output.inputCoverage?.ranges) !==
          JSON.stringify(
            target.originals.map(({ resourcePath, blockId, start, end }) => ({
              resourcePath,
              blockId,
              start,
              end,
            })),
          )
        )
          throw new BookMapError("missing-receipt")
        break
      case "synthesis":
        break
      default:
        return assertNever(target)
    }
    const coverage = CoverageVerification.parse({
      target,
      targetHash: coverageTargetHash(target),
      output: output.data,
    })
    return [
      {
        id: context.id("verify", index),
        targetHash: coverage.targetHash,
        decisions: coverage.output.decisions,
        coverage,
      },
    ]
  })
}
