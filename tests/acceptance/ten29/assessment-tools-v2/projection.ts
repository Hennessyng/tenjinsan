import { z } from "zod"
import { digest } from "./integrity.ts"

const Location = z.object({
  resourcePath: z.string(),
  blockId: z.string(),
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
})
const Span = Location.extend({ originalFragment: z.string() })
const Finding = z.object({ text: z.string(), sources: z.array(Span).min(1) })
const MapOutput = z.object({
  purpose: Finding.nullable(),
  claims: z.array(Finding),
  concepts: z.array(Finding),
  definitions: z.array(Finding),
  examples: z.array(Finding),
  qualifications: z.array(Finding),
  uncertainties: z.array(Finding),
  summary: Finding,
})
const Synthesis = z.object({
  thesis: z.array(Finding),
  progression: z.array(Finding),
  connections: z.array(Finding),
  conflicts: z.array(Finding),
  changesOfPosition: z.array(Finding),
  uncertainties: z.array(Finding),
})
export const Projection = z.object({
  canonicalText: z.string(),
  canonicalSha256: z.string(),
  parts: z
    .array(
      z.object({
        ordinal: z.number().int(),
        startUnit: z.number().int(),
        endUnit: z.number().int(),
        canonicalText: z.string(),
        excerpts: z.array(Location.extend({ text: z.string() })),
      }),
    )
    .length(4),
  unitMap: z.array(
    z.object({ char: z.string(), locations: z.array(Location), boundary: z.boolean() }),
  ),
})
export type Projection = z.infer<typeof Projection>
type Span = z.infer<typeof Span>
export type Citation = {
  readonly part: number
  readonly start: number
  readonly end: number
  readonly quote: string
}
function rawExcerpt(span: z.infer<typeof Location>, source: Projection) {
  const excerpt = source.parts
    .flatMap((part) => part.excerpts)
    .find(
      (row) =>
        row.resourcePath === span.resourcePath &&
        row.blockId === span.blockId &&
        row.start <= span.start &&
        row.end >= span.end,
    )
  if (!excerpt) throw new TypeError("Unresolved original citation")
  return excerpt.text.slice(span.start - excerpt.start, span.end - excerpt.start)
}
function neutralCitation(span: Span, source: Projection): Citation {
  if (rawExcerpt(span, source) !== span.originalFragment)
    throw new TypeError("Citation substitution")
  const indexes = source.unitMap.flatMap((unit, index) =>
    unit.locations.some(
      (location) =>
        location.resourcePath === span.resourcePath &&
        location.blockId === span.blockId &&
        location.start < span.end &&
        location.end > span.start,
    )
      ? [index]
      : [],
  )
  const first = indexes[0],
    last = indexes.at(-1)
  if (first === undefined || last === undefined || indexes.length !== last - first + 1)
    throw new TypeError("Non-bijective citation")
  const part = source.parts.find((row) => first >= row.startUnit && last < row.endUnit)
  if (!part) throw new TypeError("Cross-part citation needs explicit split")
  return {
    part: part.ordinal + 1,
    start: first - part.startUnit,
    end: last + 1 - part.startUnit,
    quote: source.unitMap
      .slice(first, last + 1)
      .map((unit) => unit.char)
      .join(""),
  }
}
export function remapCitation(citation: Citation, targetInput: unknown) {
  const target = Projection.parse(targetInput),
    part = target.parts[citation.part - 1]
  if (
    !part ||
    citation.start < 0 ||
    citation.end <= citation.start ||
    citation.end > part.endUnit - part.startUnit
  )
    throw new TypeError("Wrong citation part/range")
  const units = target.unitMap.slice(
      part.startUnit + citation.start,
      part.startUnit + citation.end,
    ),
    quote = units.map((unit) => unit.char).join("")
  if (quote !== citation.quote) throw new TypeError("Target source/candidate equivalence failed")
  const locations: z.infer<typeof Location>[] = []
  for (const unit of units)
    for (const location of unit.locations) {
      const previous = locations.at(-1)
      if (
        previous &&
        previous.resourcePath === location.resourcePath &&
        previous.blockId === location.blockId &&
        previous.end === location.start
      )
        locations[locations.length - 1] = { ...previous, end: location.end }
      else locations.push(location)
    }
  if (!locations.length) throw new TypeError("Target citation lost original text")
  const reconstructed = locations
    .map((location) => rawExcerpt(location, target))
    .join(" ")
    .replace(/\s+/gu, " ")
    .trim()
  if (reconstructed !== citation.quote)
    throw new TypeError("Target citation raw reconstruction differs")
  return { citation, targetLocations: locations, reconstructionDigest: digest({ citation, quote }) }
}
export function projectCandidate(input: unknown) {
  const artifact = z
    .object({
      projection: Projection,
      analysis: z.object({
        wholeBook: z.object({ maps: z.array(MapOutput).min(1), synthesis: Synthesis }),
      }),
    })
    .parse(input)
  const citations: Citation[] = []
  const finding = (row: z.infer<typeof Finding>) => ({
    text: row.text,
    citations: row.sources.map((span) => {
      const citation = neutralCitation(span, artifact.projection)
      citations.push(citation)
      return citation
    }),
  })
  const maps = artifact.analysis.wholeBook.maps.map((map) => ({
    purpose: map.purpose ? finding(map.purpose) : null,
    claims: map.claims.map(finding),
    concepts: map.concepts.map(finding),
    definitions: map.definitions.map(finding),
    examples: map.examples.map(finding),
    qualifications: map.qualifications.map(finding),
    uncertainties: map.uncertainties.map(finding),
    summary: finding(map.summary),
  }))
  const synthesis = artifact.analysis.wholeBook.synthesis
  const content = {
    maps,
    synthesis: {
      thesis: synthesis.thesis.map(finding),
      progression: synthesis.progression.map(finding),
      connections: synthesis.connections.map(finding),
      conflicts: synthesis.conflicts.map(finding),
      changesOfPosition: synthesis.changesOfPosition.map(finding),
      uncertainties: synthesis.uncertainties.map(finding),
    },
  }
  return { content, contentDigest: digest(content), citations, source: artifact.projection }
}
