import { contentDigest, type NormalizationRevision } from "@reading-studio/contracts"
import { z } from "zod"
import { WireRange } from "./processing-evidence.ts"

export type RequiredOriginal = {
  readonly part: string
  readonly resourcePath: string
  readonly blockId: string
  readonly text: string
}
export function auditOriginalAssembly(input: {
  readonly normalization: NormalizationRevision
  readonly payload: unknown
  readonly required: readonly RequiredOriginal[]
}) {
  const rows = z.array(WireRange).parse(z.array(z.unknown()).parse(input.payload).slice(1))
  const blocks = input.normalization.resources.flatMap((resource) =>
    resource.status === "included"
      ? resource.blocks.map((block) => ({ resourcePath: resource.path, ...block }))
      : [],
  )
  for (const row of rows) {
    const block = blocks.find(
      (item) => item.resourcePath === row.resourcePath && item.id === row.blockId,
    )
    if (
      !block ||
      !Number.isSafeInteger(row.start) ||
      !Number.isSafeInteger(row.end) ||
      row.start < 0 ||
      row.end <= row.start ||
      row.end > block.text.length ||
      block.text.slice(row.start, row.end) !== row.text
    )
      throw new TypeError("foreign-or-changed-original-evidence")
  }
  const missingParts: string[] = []
  for (const part of input.required) {
    const block = blocks.find(
      (item) => item.resourcePath === part.resourcePath && item.id === part.blockId,
    )
    if (!block || block.text !== part.text)
      throw new TypeError("authored-original-reference-mismatch")
    const spans = rows
      .filter((row) => row.resourcePath === part.resourcePath && row.blockId === part.blockId)
      .toSorted((left, right) => left.start - right.start)
    let cursor = 0
    for (const span of spans) {
      if (span.start > cursor) break
      cursor = Math.max(cursor, span.end)
    }
    if (cursor < part.text.length) missingParts.push(part.part)
  }
  return {
    loadedPaths: [...new Set(rows.map((row) => row.resourcePath))],
    missingParts,
    loadedRangeIdentities: rows.map(({ text, ...range }) => ({
      ...range,
      utf8Sha256: contentDigest(text),
      utf16Units: text.length,
    })),
    meaning:
      "literal stored-original availability only, never claim support or independent chapter understanding",
    semanticVerdict: "NOT ASSESSED" as const,
  }
}
