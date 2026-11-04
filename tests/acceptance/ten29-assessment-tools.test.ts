import { expect, it } from "vitest"
import { CriticalFlags, DimensionScores } from "./ten29/assessment-tools-v2/rubric-schema.ts"
import { rate, scoreRubric } from "./ten29/assessment-tools-v2/scoring.ts"
import frozenRubric from "./ten29/assessment-v2/rubric.json"

const dummy = {
  dimensionScores: {
    "purpose-progression": 2,
    "concepts-definitions": 2,
    "relationships-conflicts": 2,
    "qualifications-uncertainty": 2,
    "original-support": 2,
    "author-application": 2,
    "language-readability": 2,
  },
  criticalFlags: {
    "incomplete-included-processing": false,
    "material-retained-claim-error": false,
    "missed-seeded-late-reversal": false,
    "unresolved-retained-citation": false,
    "unauthorized-authority-change": false,
    "missed-seeded-critical-negative": false,
  },
  languagesProvided: ["en"],
  enJaApplicability: "not-supplied",
  languageApplicabilityReason: "DUMMY_ONLY English arithmetic fixture",
  chapters: [1, 2, 3, 4].map((partOrdinal) => ({
    partOrdinal,
    decision: "faithfully-represented",
    originalGrounding: "DUMMY_ONLY part reference",
    reason: "DUMMY_ONLY arithmetic",
  })),
}
it("uses the unchanged frozen v2 dimension and critical-flag identifiers", () => {
  expect(Object.keys(DimensionScores.shape)).toEqual(frozenRubric.dimensions.map((row) => row.id))
  expect(Object.keys(CriticalFlags.shape)).toEqual(frozenRubric.criticalFlags)
})
it("rejects a zero dimension despite a twelve-point DUMMY_ONLY total", () => {
  expect(
    scoreRubric({ ...dummy, dimensionScores: { ...dummy.dimensionScores, "original-support": 0 } })
      .accepted,
  ).toBe(false)
})
it("rejects a DUMMY_ONLY critical flag despite fourteen points", () => {
  expect(
    scoreRubric({
      ...dummy,
      criticalFlags: { ...dummy.criticalFlags, "missed-seeded-late-reversal": true },
    }).accepted,
  ).toBe(false)
})
it("returns an undefined rate rather than NaN for a zero DUMMY_ONLY denominator", () => {
  expect(rate(0, 0)).toBeNull()
})
it("uses the exact twelve-point DUMMY_ONLY boundary without averaging dimensions", () => {
  const twelve = {
    ...dummy,
    dimensionScores: {
      ...dummy.dimensionScores,
      "purpose-progression": 1,
      "concepts-definitions": 1,
    },
  }
  expect(scoreRubric(twelve)).toMatchObject({ total: 12, accepted: true })
  expect(
    scoreRubric({
      ...twelve,
      dimensionScores: { ...twelve.dimensionScores, "relationships-conflicts": 1 },
    }),
  ).toMatchObject({ total: 11, accepted: false })
})
it.each([NaN, Infinity, -1, 3, 1.5])("rejects invalid DUMMY_ONLY dimension %s", (score) => {
  expect(() =>
    scoreRubric({
      ...dummy,
      dimensionScores: { ...dummy.dimensionScores, "original-support": score },
    }),
  ).toThrow()
})
it.each(Object.keys(dummy.criticalFlags))("applies DUMMY_ONLY critical override %s", (key) => {
  expect(
    scoreRubric({ ...dummy, criticalFlags: { ...dummy.criticalFlags, [key]: true } }).accepted,
  ).toBe(false)
})
it("rejects missing DUMMY_ONLY flags and dimensions", () => {
  expect(() => scoreRubric({ ...dummy, criticalFlags: {} })).toThrow()
  expect(() => scoreRubric({ ...dummy, dimensionScores: {} })).toThrow()
})
it("does not drop or prorate dimension7 when EN/JA is not supplied", () => {
  expect(scoreRubric(dummy).total).toBe(14)
  expect(() => scoreRubric({ ...dummy, enJaApplicability: "applies" })).toThrow()
  expect(scoreRubric({ ...dummy, enJaApplicability: "unresolved" }).accepted).toBe(false)
})
it("rejects duplicate or missing DUMMY_ONLY chapter decisions", () => {
  expect(() => scoreRubric({ ...dummy, chapters: dummy.chapters.slice(1) })).toThrow()
  expect(() =>
    scoreRubric({ ...dummy, chapters: dummy.chapters.map(() => dummy.chapters[0]) }),
  ).toThrow()
})
it("keeps arithmetic rates bounded and finite", () => {
  expect(rate(1, 2)).toBe(0.5)
  for (const [n, d] of [
    [1, 0],
    [-1, 2],
    [2, 1],
    [NaN, 2],
    [0, Infinity],
  ])
    expect(() => rate(n ?? NaN, d ?? NaN)).toThrow()
})
it("keeps unknown technical facts unresolved and derives seeded misses only after reference labels", () => {
  expect(
    scoreRubric({
      ...dummy,
      criticalFlags: { ...dummy.criticalFlags, "unauthorized-authority-change": "unresolved" },
    }).unresolved,
  ).toBe(true)
  expect(
    scoreRubric({
      ...dummy,
      criticalFlags: {
        ...dummy.criticalFlags,
        "missed-seeded-critical-negative": "post-reference",
      },
    }).accepted,
  ).toBe(true)
})
