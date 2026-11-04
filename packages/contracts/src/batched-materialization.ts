import type { BookSynthesis, ChapterPartMap, MappedFinding } from "./book-map-model.ts"
import { contentDigest } from "./identity.ts"

const statement = (finding: MappedFinding) => ({
  text: finding.text,
  citations: finding.sources.map(({ resourcePath, blockId, start, end }) => ({
    resourcePath,
    blockId,
    start,
    end,
  })),
})
export function chapterMaterializationHash(map: ChapterPartMap) {
  const fields = [
    ["claims", "claim"],
    ["concepts", "concept"],
    ["definitions", "definition"],
    ["examples", "example"],
    ["qualifications", "qualification"],
    ["uncertainties", "uncertainty"],
  ] as const
  if (
    (map.purpose && map.purpose.id !== `${map.partId}-purpose-0`) ||
    map.summary.id !== `${map.partId}-summary-0` ||
    fields.some(([field, suffix]) =>
      map[field].some((finding, index) => finding.id !== `${map.partId}-${suffix}-${index}`),
    )
  )
    throw new TypeError("Foreign materialized map IDs")
  return contentDigest(
    JSON.stringify({
      complete: map.complete,
      claimStatus: map.claimStatus,
      purpose: map.purpose ? statement(map.purpose) : null,
      claims: map.claims.map(statement),
      concepts: map.concepts.map(statement),
      definitions: map.definitions.map(statement),
      examples: map.examples.map(statement),
      qualifications: map.qualifications.map(statement),
      uncertainties: map.uncertainties.map(statement),
      summary: statement(map.summary),
    }),
  )
}
export function synthesisMaterializationHash(synthesis: BookSynthesis, partId: string) {
  if (
    (
      [
        "thesis",
        "progression",
        "connections",
        "conflicts",
        "changesOfPosition",
        "uncertainties",
      ] as const
    ).some((field) =>
      synthesis[field].some((finding, index) => finding.id !== `${partId}-${field}-${index}`),
    )
  )
    throw new TypeError("Foreign materialized synthesis IDs")
  return contentDigest(
    JSON.stringify({
      complete: synthesis.complete,
      representedGroupIds: synthesis.representedGroupIds,
      thesis: synthesis.thesis.map(statement),
      progression: synthesis.progression.map(statement),
      connections: synthesis.connections.map(statement),
      conflicts: synthesis.conflicts.map(statement),
      changesOfPosition: synthesis.changesOfPosition.map(statement),
      uncertainties: synthesis.uncertainties.map(statement),
    }),
  )
}
