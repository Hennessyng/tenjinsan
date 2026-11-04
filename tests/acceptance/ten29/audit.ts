export type Range = {
  readonly resourcePath: string
  readonly blockId: string
  readonly start: number
  readonly end: number
  readonly text: string
}

// Test-only independent diagnostic. It does not grant product acceptance.
export function auditRanges(
  expected: readonly Range[],
  actual: readonly Range[],
): readonly string[] {
  const issues: string[] = []
  let index = 0
  let cursor = expected[0]?.start ?? 0
  for (const part of actual) {
    const original = expected[index]
    if (!original) {
      issues.push("unexpected-range")
      continue
    }
    if (part.resourcePath !== original.resourcePath || part.blockId !== original.blockId)
      issues.push("identity-or-order")
    if (part.start !== cursor || part.end <= part.start || part.end > original.end)
      issues.push("offset-or-duplicate")
    const text = original.text.slice(part.start - original.start, part.end - original.start)
    if (
      text !== part.text ||
      !part.text.isWellFormed() ||
      !Buffer.from(text).equals(Buffer.from(part.text))
    )
      issues.push("changed-text-or-unicode")
    cursor = part.end
    if (cursor === original.end) {
      index++
      cursor = expected[index]?.start ?? 0
    }
  }
  if (index !== expected.length) issues.push("missing-or-truncated")
  return issues
}
