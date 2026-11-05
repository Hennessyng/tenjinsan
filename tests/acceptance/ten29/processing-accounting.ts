import { auditRanges, type Range } from "./audit.ts"

export type Observations = {
  readonly originals: readonly Range[]
  readonly planned: readonly Range[]
  readonly dispatched: readonly Range[]
  readonly transmitted: readonly Range[]
  readonly processed: readonly Range[]
  readonly uncertain: readonly Range[]
  readonly context: readonly Range[]
}

export function processingAccounting(input: Observations) {
  const key = (r: Range) => JSON.stringify([r.resourcePath, r.blockId, r.start, r.end])
  const has = (ranges: readonly Range[], range: Range) => ranges.some((r) => key(r) === key(range))
  const issues = [...auditRanges(input.originals, input.planned)]
  for (const ranges of [input.dispatched, input.transmitted, input.processed, input.uncertain]) {
    let previous = -1
    for (const range of ranges) {
      const index = input.planned.findIndex((r) => key(r) === key(range) && r.text === range.text)
      if (index <= previous || index < 0) issues.push("foreign-duplicate-or-reordered-observation")
      previous = index
    }
  }
  for (const range of input.transmitted)
    if (!has(input.dispatched, range)) issues.push("confirmed-without-dispatch-evidence")
  for (const range of input.processed)
    if (!has(input.transmitted, range) || has(input.uncertain, range))
      issues.push("processed-without-certain-transmission")
  for (const range of input.uncertain)
    if (!has(input.dispatched, range)) issues.push("uncertain-without-dispatch-evidence")
  let uniqueUtf16 = 0
  let uniqueUtf8 = 0
  for (const original of input.originals) {
    let cursor = original.start
    const spans = input.context
      .filter((r) => r.resourcePath === original.resourcePath && r.blockId === original.blockId)
      .sort((a, b) => a.start - b.start)
    for (const range of spans) {
      if (
        range.start < original.start ||
        range.end > original.end ||
        range.end <= range.start ||
        original.text.slice(range.start - original.start, range.end - original.start) !== range.text
      )
        issues.push("invalid-context-range")
      const start = Math.max(cursor, range.start)
      if (range.end > start) {
        uniqueUtf16 += range.end - start
        uniqueUtf8 += Buffer.byteLength(
          original.text.slice(start - original.start, range.end - original.start),
        )
      }
      cursor = Math.max(cursor, range.end)
    }
  }
  for (const range of input.context)
    if (
      !input.originals.some(
        (r) => r.resourcePath === range.resourcePath && r.blockId === range.blockId,
      )
    )
      issues.push("foreign-context")
  const totalUtf16 = input.context.reduce((sum, range) => sum + range.end - range.start, 0)
  const totalUtf8 = input.context.reduce((sum, range) => sum + Buffer.byteLength(range.text), 0)
  return {
    ...input,
    issues,
    unsent: input.planned.filter((r) => !has(input.dispatched, r)),
    pending: input.dispatched.filter((r) => !has(input.processed, r) && !has(input.uncertain, r)),
    contextTotals: {
      totalUtf16,
      totalUtf8,
      uniqueUtf16,
      uniqueUtf8,
      repeatedUtf16: totalUtf16 - uniqueUtf16,
      repeatedUtf8: totalUtf8 - uniqueUtf8,
    },
  }
}
