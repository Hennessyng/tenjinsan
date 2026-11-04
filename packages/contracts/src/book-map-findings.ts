import type { BookSynthesis, ChapterPartMap, WholeBookPreparation } from "./book-preparation.ts"

export function chapterFindings(map: ChapterPartMap) {
  return [
    ...(map.purpose ? [map.purpose] : []),
    ...map.claims,
    ...map.concepts,
    ...map.definitions,
    ...map.examples,
    ...map.qualifications,
    ...map.uncertainties,
    map.summary,
  ]
}
export function synthesisFindings(synthesis: BookSynthesis) {
  return [
    ...synthesis.thesis,
    ...synthesis.progression,
    ...synthesis.connections,
    ...synthesis.conflicts,
    ...synthesis.changesOfPosition,
    ...synthesis.uncertainties,
  ]
}
export function bookMapProjection(preparation: WholeBookPreparation) {
  const synthesis = preparation.synthesis
  return {
    claims: preparation.maps.flatMap((map) => map.claims),
    concepts: [
      ...preparation.maps.flatMap((map) => [
        ...(map.purpose ? [map.purpose] : []),
        ...map.concepts,
        ...map.definitions,
        ...map.examples,
        map.summary,
      ]),
      ...(synthesis
        ? [
            ...synthesis.thesis,
            ...synthesis.progression,
            ...synthesis.connections,
            ...synthesis.changesOfPosition,
          ]
        : []),
    ],
    qualifications: [
      ...preparation.maps.flatMap((map) => [...map.qualifications, ...map.uncertainties]),
      ...(synthesis ? [...synthesis.conflicts, ...synthesis.uncertainties] : []),
    ],
  }
}
