import {
  type BatchedVerificationTarget,
  CoverageVerificationOutput,
  type CoverageVerificationTarget,
  coverageVerificationAccepted,
  coverageVerificationSchema,
} from "@reading-studio/contracts"
import { z } from "zod"

const LegacySupport = z.object({
  decisions: z
    .array(z.object({ verdict: z.enum(["supported", "unsupported", "overstated", "uncertain"]) }))
    .min(1),
})
export function sourceSemanticSupport(input: {
  readonly target: CoverageVerificationTarget | undefined
  readonly output: unknown
  readonly requiredCoverage: boolean
  readonly batchTarget?: BatchedVerificationTarget | undefined
}): "supported" | "attention" | "not-established" {
  if (input.batchTarget) {
    const output = CoverageVerificationOutput.safeParse(input.output),
      target = input.batchTarget
    if (!output.success) return "not-established"
    const ids = new Set(output.data.decisions.map((decision) => decision.id))
    if (
      ids.size !== target.findingIds.length ||
      output.data.decisions.length !== target.findingIds.length ||
      !target.findingIds.every((id) => ids.has(id))
    )
      return "not-established"
    const mapAccepts =
      target.kind === "map-omission"
        ? output.data.mapCoverage?.verdict === "none" &&
          output.data.mapCoverage.sources.length === 0
        : output.data.mapCoverage === null
    return mapAccepts &&
      output.data.decisions.every(
        (decision) =>
          decision.verdict === "supported" ||
          (target.kind === "window-findings" && decision.verdict === "not-addressed"),
      )
      ? "supported"
      : "attention"
  }
  if (input.target) {
    const parsed = coverageVerificationSchema(input.target).safeParse(input.output)
    if (!parsed.success) return "not-established"
    return coverageVerificationAccepted(input.target, parsed.data) ? "supported" : "attention"
  }
  if (input.requiredCoverage) return "not-established"
  const parsed = LegacySupport.safeParse(input.output)
  if (!parsed.success) return "not-established"
  return parsed.data.decisions.every((decision) => decision.verdict === "supported")
    ? "supported"
    : "attention"
}
