import { expect, it } from "vitest"
import { auditRanges, type Range } from "./ten29/audit.ts"

const originals: readonly Range[] = [
  { resourcePath: "a", blockId: "one", start: 0, end: 4, text: "A🧭B" },
  { resourcePath: "b", blockId: "two", start: 0, end: 2, text: "日本" },
  { resourcePath: "c", blockId: "late", start: 0, end: 3, text: "end" },
]

it("accepts contiguous split Unicode source ranges", () => {
  // Given
  const [first, ...rest] = originals
  if (!first) throw new TypeError("Missing source")
  // When
  const issues = auditRanges(originals, [
    { ...first, end: 1, text: "A" },
    { ...first, start: 1, text: "🧭B" },
    ...rest,
  ])
  // Then
  expect(issues).toEqual([])
})

it.each([
  "dropped",
  "reordered",
  "truncated",
  "duplicate",
  "changed",
  "identity",
  "surrogate",
] as const)("detects %s coverage corruption", (fault) => {
  // Given
  const [first, middle, late] = originals
  if (!first || !middle || !late) throw new TypeError("Missing sources")
  const corruptions = {
    dropped: [first, late],
    reordered: [middle, first, late],
    truncated: [first, middle, { ...late, end: 2, text: "en" }],
    duplicate: [first, first, middle, late],
    changed: [{ ...first, text: "AxxB" }, middle, late],
    identity: [{ ...first, blockId: "substituted" }, middle, late],
    surrogate: [
      { ...first, end: 2, text: "A\ud83e" },
      { ...first, start: 2, text: "\uddedB" },
      middle,
      late,
    ],
  }
  // When
  const issues = auditRanges(originals, corruptions[fault])
  // Then
  const expected = {
    dropped: [
      "identity-or-order",
      "offset-or-duplicate",
      "changed-text-or-unicode",
      "missing-or-truncated",
    ],
    reordered: [
      "identity-or-order",
      "offset-or-duplicate",
      "changed-text-or-unicode",
      "missing-or-truncated",
    ],
    truncated: ["missing-or-truncated"],
    duplicate: ["identity-or-order", "offset-or-duplicate", "changed-text-or-unicode"],
    changed: ["changed-text-or-unicode"],
    identity: ["identity-or-order"],
    surrogate: ["changed-text-or-unicode"],
  }
  expect([...new Set(issues)].sort()).toEqual(expected[fault].toSorted())
})
