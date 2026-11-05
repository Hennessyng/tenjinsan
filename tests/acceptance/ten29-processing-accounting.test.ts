import { expect, it } from "vitest"
import type { Range } from "./ten29/audit.ts"
import { type Observations, processingAccounting } from "./ten29/processing-accounting.ts"

const first: Range = { resourcePath: "a", blockId: "one", start: 0, end: 4, text: "A🧭B" }
const late: Range = { resourcePath: "b", blockId: "late", start: 0, end: 2, text: "日本" }
const base: Observations = {
  originals: [first, late],
  planned: [first, late],
  dispatched: [first],
  transmitted: [],
  processed: [],
  uncertain: [first],
  context: [],
}

it("keeps unsent and uncertain distinct without inventing a confirmed transmission", () => {
  // Given / When
  const ledger = processingAccounting(base)
  // Then
  expect(ledger.unsent).toEqual([late])
  expect(ledger.uncertain).toEqual([first])
  expect(ledger.processed).toEqual([])
  expect(ledger.transmitted).toEqual([])
  expect(ledger.pending).toEqual([])
  expect(ledger.issues).toEqual([])
})

it.each([
  "untransmitted-processed",
  "uncertain-processed",
  "reordered",
  "duplicate",
  "foreign",
  "dropped-plan",
  "uncertain-without-dispatch",
  "confirmed-without-dispatch",
] as const)("detects %s accounting contradiction", (fault) => {
  // Given
  const variants = {
    "untransmitted-processed": { ...base, processed: [late] },
    "uncertain-processed": { ...base, transmitted: [first], processed: [first] },
    reordered: { ...base, dispatched: [first, late], transmitted: [late, first], uncertain: [] },
    duplicate: { ...base, transmitted: [first, first] },
    foreign: { ...base, transmitted: [{ ...first, blockId: "foreign" }] },
    "dropped-plan": { ...base, planned: [first] },
    "uncertain-without-dispatch": { ...base, dispatched: [] },
    "confirmed-without-dispatch": { ...base, dispatched: [], transmitted: [first], uncertain: [] },
  }
  // When
  const ledger = processingAccounting(variants[fault])
  // Then
  const expected = {
    "untransmitted-processed": ["processed-without-certain-transmission"],
    "uncertain-processed": ["processed-without-certain-transmission"],
    reordered: ["foreign-duplicate-or-reordered-observation"],
    duplicate: ["foreign-duplicate-or-reordered-observation"],
    foreign: ["foreign-duplicate-or-reordered-observation", "confirmed-without-dispatch-evidence"],
    "dropped-plan": ["missing-or-truncated"],
    "uncertain-without-dispatch": ["uncertain-without-dispatch-evidence"],
    "confirmed-without-dispatch": ["confirmed-without-dispatch-evidence"],
  }
  expect([...new Set(ledger.issues)].sort()).toEqual(expected[fault].toSorted())
})

it("counts contextual overlap separately from unique UTF16 and UTF8 coverage", () => {
  // Given
  const context = [
    { ...first, end: 3, text: "A🧭" },
    { ...first, start: 1, text: "🧭B" },
  ]
  // When
  const ledger = processingAccounting({ ...base, context })
  // Then
  expect(ledger.contextTotals).toEqual({
    totalUtf16: 6,
    totalUtf8: 10,
    uniqueUtf16: 4,
    uniqueUtf8: 6,
    repeatedUtf16: 2,
    repeatedUtf8: 4,
  })
})
