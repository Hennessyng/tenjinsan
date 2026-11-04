import { expect, it } from "vitest"
import { projectCandidate, remapCitation } from "./ten29/assessment-tools-v2/projection.ts"

function dummyArtifact() {
  const texts = ["DUMMY_ONLY Café 🧭", "DUMMY_ONLY two", "DUMMY_ONLY three", "DUMMY_ONLY four"]
  let cursor = 0
  const parts = texts.map((text, ordinal) => {
    const startUnit = cursor
    cursor += Array.from(text).length + 1
    return {
      ordinal,
      startUnit,
      endUnit: cursor - 1,
      canonicalText: text,
      excerpts: [
        {
          resourcePath: `internal-${ordinal}`,
          blockId: `b${ordinal}`,
          start: 0,
          end: text.length,
          text,
        },
      ],
    }
  })
  const unitMap = parts.flatMap((part, ordinal) => {
    let offset = 0
    const units = Array.from(part.canonicalText).map((char) => {
      const location = {
        resourcePath: `internal-${ordinal}`,
        blockId: `b${ordinal}`,
        start: offset,
        end: offset + char.length,
      }
      offset += char.length
      return { char, locations: [location], boundary: false }
    })
    return ordinal < 3 ? [...units, { char: " ", locations: [], boundary: true }] : units
  })
  const finding = {
    text: "DUMMY_ONLY no semantic claim",
    sources: [
      {
        resourcePath: "internal-0",
        blockId: "b0",
        start: 0,
        end: texts[0]?.length,
        originalFragment: texts[0],
      },
    ],
  }
  return {
    projection: { canonicalText: texts.join(" "), canonicalSha256: "a".repeat(64), parts, unitMap },
    analysis: {
      status: "successful",
      wholeBook: {
        maps: [
          {
            purpose: null,
            claims: [],
            concepts: [],
            definitions: [],
            examples: [],
            qualifications: [],
            uncertainties: [],
            summary: finding,
          },
        ],
        synthesis: {
          thesis: [finding],
          progression: [finding],
          connections: [],
          conflicts: [],
          changesOfPosition: [],
          uncertainties: [],
        },
      },
    },
    privateId: "DUMMY_AUTHOR_HINT",
    verdict: "supported",
    family: "DUMMY_PRIVATE_FAMILY",
  }
}
it("projects only neutral persisted content and exact canonical citations", () => {
  const projected = projectCandidate(dummyArtifact()),
    serialized = JSON.stringify(projected.content)
  expect(serialized).not.toMatch(
    /DUMMY_AUTHOR_HINT|DUMMY_PRIVATE_FAMILY|internal-|blockId|resourcePath|supported|successful/u,
  )
  expect(projected.citations[0]).toMatchObject({ part: 1, start: 0, quote: "DUMMY_ONLY Café 🧭" })
  for (const citation of projected.citations)
    expect(remapCitation(citation, dummyArtifact().projection).citation).toEqual(citation)
})
it("rejects substituted original quotations and non-bijective target content", () => {
  const artifact = dummyArtifact(),
    finding = artifact.analysis.wholeBook.synthesis.thesis[0]
  if (!finding?.sources[0]) throw new TypeError("Missing DUMMY_ONLY citation")
  finding.sources[0].originalFragment = "FORGED DUMMY_ONLY"
  expect(() => projectCandidate(artifact)).toThrow("substitution")
  const original = dummyArtifact(),
    citation = projectCandidate(original).citations[0]
  if (!citation) throw new TypeError("Missing DUMMY_ONLY citation")
  const target = dummyArtifact().projection
  target.parts[0]?.excerpts.forEach((row) => {
    row.text = "FORGED DUMMY_ONLY"
  })
  expect(() => remapCitation(citation, target)).toThrow("reconstruction")
  expect(() =>
    remapCitation({ ...citation, quote: citation.quote.normalize("NFC") }, original.projection),
  ).toThrow("equivalence")
})
