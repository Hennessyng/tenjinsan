import {
  type AnalysisRevision,
  COVERAGE_VERIFICATION_VERSION,
  CoverageMapReferences,
  CoverageSynthesisReferences,
  chapterFindings,
  coverageMapReferences,
  coverageSynthesisReferences,
  coverageTargetHash,
  MappedFinding,
  type NormalizationRevision,
  synthesisFindings,
} from "@reading-studio/contracts"
import { z } from "zod"
import { auditOriginalAssembly } from "./evaluator-evidence.ts"
import { WireRange, wirePayload } from "./processing-evidence.ts"

export function nativeCoveragePayloads(turns: unknown) {
  return z
    .array(z.object({ input: z.array(z.object({ text: z.string() })) }))
    .parse(turns)
    .map((turn) => {
      const text = turn.input[0]?.text
      if (!text) throw new TypeError("Missing native text")
      return wirePayload(text)
    })
}
const Header = z.object({
  kind: z.string(),
  verificationVersion: z.string().optional(),
  targetHash: z.string().optional(),
  scope: z.object({ kind: z.string(), partId: z.string().optional() }).optional(),
})
const Window = z.object({
  verificationVersion: z.literal(COVERAGE_VERIFICATION_VERSION),
  targetHash: z.string(),
  scope: z.object({ kind: z.literal("window"), partId: z.string() }),
  map: CoverageMapReferences,
  synthesis: CoverageSynthesisReferences,
  interpretations: z.array(MappedFinding),
  mapCoverageRequired: z.literal(true),
})
export function auditCoveragePath(input: {
  readonly analysis: AnalysisRevision
  readonly normalization: NormalizationRevision
  readonly payloads: readonly (readonly unknown[])[]
}) {
  const data = input.analysis.wholeBook
  if (!data?.synthesis || data.synthesisVersion !== COVERAGE_VERIFICATION_VERSION)
    throw new TypeError("Missing explicit coverage policy")
  const checks = input.payloads.filter(
    (payload) => Header.parse(payload[0]).kind === "original-verification",
  )
  const windows = checks.filter((payload) => Header.parse(payload[0]).scope?.kind === "window")
  if (windows.length !== data.parts.length || checks.length !== data.parts.length + 1)
    throw new TypeError("Missing planned verification jobs")
  const rows = windows.flatMap((payload) => {
    const header = Window.parse(payload[0])
    const map = data.maps.find((map) => map.partId === header.scope.partId)
    const part = data.parts.find((part) => part.id === header.scope.partId)
    const saved = data.verification.find((check) => check.targetHash === header.targetHash)
    const target = saved?.coverage?.target
    if (
      !map ||
      !part ||
      target?.kind !== "window" ||
      coverageTargetHash(target) !== header.targetHash ||
      JSON.stringify(header.map) !== JSON.stringify(coverageMapReferences(map)) ||
      JSON.stringify(header.synthesis) !==
        JSON.stringify(coverageSynthesisReferences(data.synthesis)) ||
      JSON.stringify(header.interpretations) !==
        JSON.stringify([...chapterFindings(map), ...synthesisFindings(data.synthesis)])
    )
      throw new TypeError("Window lacks exact own-map/global candidate/receipt binding")
    const originals = z.array(WireRange).parse(payload.slice(1))
    if (
      JSON.stringify(
        originals.map(({ resourcePath, blockId, start, end }) => ({
          resourcePath,
          blockId,
          start,
          end,
        })),
      ) !== JSON.stringify(part.ranges)
    )
      throw new TypeError("Verification lacks full planned window")
    return originals
  })
  const required = input.normalization.resources.flatMap((resource) =>
    resource.status === "included"
      ? resource.blocks.map((block) => ({
          part: block.id,
          resourcePath: resource.path,
          blockId: block.id,
          text: block.text,
        }))
      : [],
  )
  const payload = [{ kind: "aggregate-bound-window-verifications" }, ...rows]
  const audit = auditOriginalAssembly({ normalization: input.normalization, payload, required })
  return {
    policy: COVERAGE_VERIFICATION_VERSION,
    windows: windows.length,
    checks: checks.length,
    payload,
    audit,
    semanticVerdict: "NOT ASSESSED" as const,
  }
}
