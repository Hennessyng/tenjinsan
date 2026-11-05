import { z } from "zod"
import { chapterFindings, synthesisFindings } from "./book-map-findings.ts"
import { BookSynthesis, ChapterPartMap, PreparedRange } from "./book-map-model.ts"
import { contentDigest } from "./identity.ts"
import {
  assertNever,
  BlockId,
  ContentId,
  Digest,
  EditionId,
  Natural,
  NormalizationRevisionId,
  ResourcePath,
  Text,
} from "./primitives.ts"

export const COVERAGE_VERIFICATION_VERSION = "windows-original-check-3" as const
export const WindowOriginal = z
  .strictObject({
    editionId: EditionId,
    normalizationRevisionId: NormalizationRevisionId,
    resourcePath: ResourcePath,
    blockId: BlockId,
    start: Natural,
    end: Natural,
    originalFragment: z.string().min(1).max(100_000),
    pageLabel: Text.optional(),
  })
  .refine(
    (span) =>
      span.end > span.start &&
      span.originalFragment.length === span.end - span.start &&
      span.originalFragment.isWellFormed(),
    "original window must preserve exact UTF-16 source units",
  )
  .readonly()
export type WindowOriginal = z.infer<typeof WindowOriginal>
export const CoverageVerificationTarget = z
  .discriminatedUnion("kind", [
    z.strictObject({
      version: z.literal(COVERAGE_VERIFICATION_VERSION),
      kind: z.literal("window"),
      originals: z.array(WindowOriginal).min(1).readonly(),
      map: ChapterPartMap,
      synthesis: BookSynthesis,
    }),
    z.strictObject({
      version: z.literal(COVERAGE_VERIFICATION_VERSION),
      kind: z.literal("synthesis"),
      synthesis: BookSynthesis,
    }),
  ])
  .readonly()
export type CoverageVerificationTarget = z.infer<typeof CoverageVerificationTarget>

export const CoverageVerificationOutput = z.strictObject({
  decisions: z
    .array(
      z.strictObject({
        id: ContentId,
        verdict: z.enum([
          "supported",
          "contradicted",
          "qualifies",
          "not-addressed",
          "unsupported",
          "overstated",
          "uncertain",
        ]),
        explanation: z.string().trim().min(1).max(2000),
      }),
    )
    .max(1024),
  mapCoverage: z
    .strictObject({
      verdict: z.enum(["none", "material-omission", "uncertain"]),
      explanation: z.string().trim().min(1).max(2000),
      sources: z.array(PreparedRange).max(32),
    })
    .nullable(),
})
export type CoverageVerificationOutput = z.infer<typeof CoverageVerificationOutput>

export function coverageInterpretations(target: CoverageVerificationTarget) {
  switch (target.kind) {
    case "window":
      return [...chapterFindings(target.map), ...synthesisFindings(target.synthesis)]
    case "synthesis":
      return synthesisFindings(target.synthesis)
    default:
      return assertNever(target)
  }
}

export function coverageTargetHash(target: CoverageVerificationTarget) {
  return contentDigest(JSON.stringify(target))
}

export function coverageVerificationSchema(target: CoverageVerificationTarget) {
  const findings = coverageInterpretations(target)
  return CoverageVerificationOutput.superRefine((output, ctx) => {
    const ids = new Set(output.decisions.map((decision) => decision.id))
    if (
      ids.size !== findings.length ||
      output.decisions.length !== findings.length ||
      !findings.every((finding) => ids.has(finding.id))
    )
      ctx.addIssue({ code: "custom", message: "missing or foreign scoped verdict" })
    switch (target.kind) {
      case "synthesis":
        if (output.mapCoverage !== null)
          ctx.addIssue({ code: "custom", message: "synthesis check cannot assess a window map" })
        break
      case "window": {
        const coverage = output.mapCoverage
        if (!coverage) {
          ctx.addIssue({ code: "custom", message: "missing material map omission assessment" })
          break
        }
        if (
          (coverage.verdict === "material-omission" && coverage.sources.length === 0) ||
          (coverage.verdict === "none" && coverage.sources.length > 0)
        )
          ctx.addIssue({ code: "custom", message: "map omission evidence does not match verdict" })
        for (const span of coverage.sources)
          if (
            span.end <= span.start ||
            !target.originals.some(
              (original) =>
                original.resourcePath === span.resourcePath &&
                original.blockId === span.blockId &&
                span.start >= original.start &&
                span.end <= original.end,
            )
          )
            ctx.addIssue({
              code: "custom",
              message: "map omission evidence exceeds original window",
            })
        break
      }
      default:
        assertNever(target)
    }
  })
}

export function coverageVerificationAccepted(target: CoverageVerificationTarget, raw: unknown) {
  const output = coverageVerificationSchema(target).parse(raw)
  switch (target.kind) {
    case "synthesis":
      return output.decisions.every((decision) => decision.verdict === "supported")
    case "window": {
      const mapIds = new Set(chapterFindings(target.map).map((finding) => finding.id))
      return (
        output.mapCoverage?.verdict === "none" &&
        output.decisions.every(
          (decision) =>
            decision.verdict === "supported" ||
            (decision.verdict === "not-addressed" && !mapIds.has(decision.id)),
        )
      )
    }
    default:
      return assertNever(target)
  }
}

export const CoverageVerification = z
  .strictObject({
    target: CoverageVerificationTarget,
    targetHash: Digest,
    output: CoverageVerificationOutput,
  })
  .superRefine((check, ctx) => {
    if (coverageTargetHash(check.target) !== check.targetHash)
      ctx.addIssue({ code: "custom", message: "verification target identity mismatch" })
    const result = coverageVerificationSchema(check.target).safeParse(check.output)
    if (!result.success)
      ctx.addIssue({ code: "custom", message: "verification output does not bind target" })
  })
  .readonly()
export type CoverageVerification = z.infer<typeof CoverageVerification>
