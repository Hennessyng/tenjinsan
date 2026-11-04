import { z } from "zod"
import type { BookSynthesis, ChapterPartMap } from "./book-map-model.ts"
import { ContentId, Text } from "./primitives.ts"

export const COVERAGE_WIRE_VERSION = "finding-refs-1" as const
const References = z.array(ContentId).max(64).readonly()
export const CoverageMapReferences = z
  .strictObject({
    partId: Text,
    groupId: Text,
    complete: z.boolean(),
    claimStatus: z.enum(["claims", "no-claim", "uncertain"]),
    purpose: ContentId.nullable(),
    summary: ContentId,
    claims: References,
    concepts: References,
    definitions: References,
    examples: References,
    qualifications: References,
    uncertainties: References,
  })
  .readonly()
export const CoverageSynthesisReferences = z
  .strictObject({
    strategy: z.enum(["complete-maps-and-original", "complete-maps"]),
    complete: z.boolean(),
    representedGroupIds: z.array(Text).max(128).readonly(),
    thesis: References,
    progression: References,
    connections: References,
    conflicts: References,
    changesOfPosition: References,
    uncertainties: References,
  })
  .readonly()
export function coverageMapReferences(map: ChapterPartMap) {
  return CoverageMapReferences.parse({
    ...map,
    purpose: map.purpose?.id ?? null,
    summary: map.summary.id,
    claims: map.claims.map((finding) => finding.id),
    concepts: map.concepts.map((finding) => finding.id),
    definitions: map.definitions.map((finding) => finding.id),
    examples: map.examples.map((finding) => finding.id),
    qualifications: map.qualifications.map((finding) => finding.id),
    uncertainties: map.uncertainties.map((finding) => finding.id),
  })
}
export function coverageSynthesisReferences(synthesis: BookSynthesis) {
  return CoverageSynthesisReferences.parse({
    ...synthesis,
    thesis: synthesis.thesis.map((finding) => finding.id),
    progression: synthesis.progression.map((finding) => finding.id),
    connections: synthesis.connections.map((finding) => finding.id),
    conflicts: synthesis.conflicts.map((finding) => finding.id),
    changesOfPosition: synthesis.changesOfPosition.map((finding) => finding.id),
    uncertainties: synthesis.uncertainties.map((finding) => finding.id),
  })
}
