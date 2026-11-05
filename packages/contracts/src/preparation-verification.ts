import { z } from "zod"
import { chapterFindings, synthesisFindings } from "./book-map-findings.ts"
import {
  type BookSynthesis,
  type ChapterPartMap,
  type PreparedRange,
  SourceSemanticDecision,
} from "./book-map-model.ts"
import {
  COVERAGE_VERIFICATION_VERSION,
  CoverageVerification,
  CoverageVerificationOutput,
  coverageVerificationAccepted,
} from "./coverage-verification.ts"
import { contentDigest } from "./identity.ts"
import { assertNever, Text } from "./primitives.ts"

export const WholeBookVerification = z
  .strictObject({
    id: Text,
    targetHash: Text,
    decisions: z
      .array(z.union([SourceSemanticDecision, CoverageVerificationOutput.shape.decisions.element]))
      .readonly(),
    coverage: CoverageVerification.optional(),
  })
  .readonly()
export type WholeBookVerification = z.infer<typeof WholeBookVerification>

export function wholeBookCheckAccepted(check: WholeBookVerification) {
  return check.coverage
    ? coverageVerificationAccepted(check.coverage.target, check.coverage.output)
    : check.decisions.every((decision) => decision.verdict === "supported")
}

type Preparation = {
  readonly synthesisVersion: string
  readonly phase: string
  readonly parts: readonly {
    readonly id: string
    readonly groupId: string
    readonly ranges: readonly z.infer<typeof PreparedRange>[]
  }[]
  readonly maps: readonly ChapterPartMap[]
  readonly synthesis: BookSynthesis | null
  readonly verification: readonly WholeBookVerification[]
}
const rangeIdentity = ({ resourcePath, blockId, start, end }: z.infer<typeof PreparedRange>) => ({
  resourcePath,
  blockId,
  start,
  end,
})
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)

export function preparationVerificationIssues(value: Preparation) {
  const issues: string[] = []
  const keys = new Set<string>()
  if (new Set(value.verification.map((check) => check.id)).size !== value.verification.length)
    issues.push("duplicate verification job identity")
  if (value.synthesisVersion === COVERAGE_VERIFICATION_VERSION) {
    for (const check of value.verification) {
      const coverage = check.coverage
      if (
        !coverage ||
        check.targetHash !== coverage.targetHash ||
        !same(check.decisions, coverage.output.decisions)
      ) {
        issues.push("missing or substituted coverage verification binding")
        continue
      }
      const target = coverage.target
      if (!same(target.synthesis, value.synthesis))
        issues.push("verification binds foreign global synthesis")
      let key: string
      switch (target.kind) {
        case "synthesis":
          key = "synthesis"
          break
        case "window": {
          const part = value.parts.find((part) => part.id === target.map.partId)
          const map = value.maps.find((map) => map.partId === target.map.partId)
          if (
            !part ||
            part.groupId !== target.map.groupId ||
            !same(map, target.map) ||
            !same(part.ranges, target.originals.map(rangeIdentity))
          )
            issues.push("verification omits or substitutes planned original window or map")
          key = `window:${target.map.partId}`
          break
        }
        default:
          return assertNever(target)
      }
      if (keys.has(key)) issues.push("duplicate coverage verification target")
      keys.add(key)
    }
    if (
      value.phase === "complete" &&
      (!keys.has("synthesis") ||
        value.parts.some((part) => !keys.has(`window:${part.id}`)) ||
        keys.size !== value.parts.length + 1)
    )
      issues.push("whole-book completion lacks every planned window and synthesis check")
  } else {
    const targets = [
      ...value.maps.map(chapterFindings),
      ...(value.synthesis ? [synthesisFindings(value.synthesis)] : []),
    ]
    for (const check of value.verification) {
      const target = targets.find(
        (findings) => contentDigest(JSON.stringify(findings)) === check.targetHash,
      )
      if (
        check.coverage ||
        !target ||
        keys.has(check.targetHash) ||
        check.decisions.length !== target.length ||
        new Set(check.decisions.map((decision) => decision.id)).size !== target.length ||
        !target.every((finding) =>
          check.decisions.some((decision) => decision.id === finding.id),
        ) ||
        check.decisions.some((decision) => !SourceSemanticDecision.safeParse(decision).success)
      )
        issues.push("semantic verdict does not bind exact interpretations")
      keys.add(check.targetHash)
    }
    if (value.phase === "complete" && keys.size !== targets.length)
      issues.push("whole-book completion is unverified")
  }
  if (
    value.phase === "complete" &&
    value.verification.some((check) => !wholeBookCheckAccepted(check))
  )
    issues.push("whole-book completion has blocking scoped outcomes")
  return issues
}
