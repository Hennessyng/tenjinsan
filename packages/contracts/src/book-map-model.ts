import { z } from "zod"
import { BlockId, ContentId, Natural, ResourcePath, Text, uniqueItems } from "./primitives.ts"
import { SourceSpan } from "./source.ts"

export const PreparedRange = z
  .strictObject({ resourcePath: ResourcePath, blockId: BlockId, start: Natural, end: Natural })
  .readonly()
export const MappedFinding = z
  .strictObject({ id: ContentId, text: Text, sources: z.array(SourceSpan).min(1).readonly() })
  .readonly()
export type MappedFinding = z.infer<typeof MappedFinding>
export const ChapterPartMap = z
  .strictObject({
    partId: Text,
    groupId: Text,
    complete: z.boolean(),
    claimStatus: z.enum(["claims", "no-claim", "uncertain"]),
    purpose: MappedFinding.nullable(),
    claims: uniqueItems(MappedFinding),
    concepts: uniqueItems(MappedFinding),
    definitions: uniqueItems(MappedFinding),
    examples: uniqueItems(MappedFinding),
    qualifications: uniqueItems(MappedFinding),
    uncertainties: uniqueItems(MappedFinding),
    summary: MappedFinding,
  })
  .readonly()
export type ChapterPartMap = z.infer<typeof ChapterPartMap>
export const BookSynthesis = z
  .strictObject({
    strategy: z.enum(["complete-maps-and-original", "complete-maps"]),
    complete: z.boolean(),
    representedGroupIds: z.array(Text).readonly(),
    thesis: uniqueItems(MappedFinding),
    progression: uniqueItems(MappedFinding),
    connections: uniqueItems(MappedFinding),
    conflicts: uniqueItems(MappedFinding),
    changesOfPosition: uniqueItems(MappedFinding),
    uncertainties: uniqueItems(MappedFinding),
  })
  .readonly()
export type BookSynthesis = z.infer<typeof BookSynthesis>
export const SourceSemanticDecision = z
  .strictObject({
    id: ContentId,
    verdict: z.enum(["supported", "unsupported", "overstated", "uncertain"]),
    explanation: Text,
  })
  .readonly()
export type SourceSemanticDecision = z.infer<typeof SourceSemanticDecision>
