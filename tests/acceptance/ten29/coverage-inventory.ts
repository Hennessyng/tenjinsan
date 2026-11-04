import { createHash } from "node:crypto"
import type { BookEdition, NormalizationRevision } from "@reading-studio/contracts"
import { z } from "zod"
export type CoverageSource = {
  readonly edition: BookEdition
  readonly normalization: NormalizationRevision
  readonly spine: readonly {
    readonly path: string
    readonly role: "main-chapter" | "supplementary"
  }[]
}
const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, item]) => [key, canonical(item)]),
        )
      : value
export const coverageDigest = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex")
export const textDigest = (text: string) => createHash("sha256").update(text).digest("hex")
export function createCoverageInventory(source: CoverageSource) {
  const { edition, normalization, spine } = source
  if (
    edition.id !== normalization.editionId ||
    edition.originalHash !== normalization.editionHash ||
    edition.originalBlobHash !== edition.originalHash
  )
    throw new TypeError("Coverage source identity mismatch")
  if (
    new Set(spine.map((row) => row.path)).size !== spine.length ||
    spine.some(
      (row) =>
        !normalization.resources.some(
          (resource) => resource.path === row.path && resource.role === row.role,
        ),
    )
  )
    throw new TypeError("Spine resource identity/role mismatch")
  if (
    JSON.stringify(
      normalization.resources
        .filter((resource) => spine.some((row) => row.path === resource.path))
        .map((resource) => resource.path),
    ) !== JSON.stringify(spine.map((row) => row.path))
  )
    throw new TypeError("Spine order mismatch")
  let streamUtf16 = 0,
    streamUtf8 = 0,
    blockOrder = 0
  const primaryRanges: {
    readonly rangeId: string
    readonly order: number
    readonly resourceOrder: number
    readonly spineOrder: number | null
    readonly blockOrder: number
    readonly globalBlockOrder: number
    readonly resourcePath: string
    readonly blockId: string
    readonly role: string
    readonly utf16: { readonly start: number; readonly end: number }
    readonly utf8: { readonly start: number; readonly end: number }
    readonly streamUtf16: { readonly start: number; readonly end: number }
    readonly streamUtf8: { readonly start: number; readonly end: number }
    readonly textSha256: string
  }[] = []
  const anchors: {
    readonly resourcePath: string
    readonly blockId: string
    readonly resourceOrder: number
    readonly spineOrder: number | null
    readonly blockOrder: number
    readonly globalBlockOrder: number
    readonly role: string
  }[] = []
  const resources = normalization.resources.map((resource, resourceOrder) => {
    const index = spine.findIndex((row) => row.path === resource.path),
      spineOrder = index < 0 ? null : index
    const rangeIds: string[] = [],
      anchorIds: string[] = []
    if (resource.status === "included")
      for (const [localOrder, block] of resource.blocks.entries()) {
        const currentBlockOrder = blockOrder++
        if (!block.text.isWellFormed()) throw new TypeError("Ill-formed normalized source Unicode")
        if (!block.text.length) {
          anchors.push({
            resourcePath: resource.path,
            blockId: block.id,
            resourceOrder,
            spineOrder,
            blockOrder: localOrder,
            globalBlockOrder: currentBlockOrder,
            role: resource.role,
          })
          anchorIds.push(block.id)
          continue
        }
        const bytes = Buffer.byteLength(block.text, "utf8"),
          rangeId = `coverage-${coverageDigest([normalization.id, resource.path, block.id, 0, block.text.length])}`
        primaryRanges.push({
          rangeId,
          order: primaryRanges.length,
          resourceOrder,
          spineOrder,
          blockOrder: localOrder,
          globalBlockOrder: currentBlockOrder,
          resourcePath: resource.path,
          blockId: block.id,
          role: resource.role,
          utf16: { start: 0, end: block.text.length },
          utf8: { start: 0, end: bytes },
          streamUtf16: { start: streamUtf16, end: streamUtf16 + block.text.length },
          streamUtf8: { start: streamUtf8, end: streamUtf8 + bytes },
          textSha256: textDigest(block.text),
        })
        streamUtf16 += block.text.length
        streamUtf8 += bytes
        rangeIds.push(rangeId)
      }
    return {
      resourceOrder,
      spineOrder,
      resourcePath: resource.path,
      role: resource.role,
      status: resource.status,
      exclusionReason: resource.status === "excluded" ? resource.reason : null,
      primaryRangeIds: rangeIds,
      anchorIds,
    }
  })
  return {
    version: "TEN29-readable-source-inventory-1" as const,
    source: {
      editionId: edition.id,
      originalSha256: edition.originalHash,
      normalizationId: normalization.id,
      parserVersion: normalization.parserVersion,
      normalizerVersion: normalization.normalizerVersion,
      sourceCoverage: normalization.coverage,
      normalizationContentDigest: coverageDigest(normalization),
      spineOrderDigest: coverageDigest(spine),
    },
    resources,
    primaryRanges,
    anchors,
    omissions: normalization.omissions ?? [],
    overlapContext: {
      policy: "separate from primary coverage; never counted as another primary range",
      ranges: [],
    },
    totals: {
      spineItems: spine.length,
      resources: resources.length,
      readableBlocks: primaryRanges.length,
      anchorOnlyBlocks: anchors.length,
      blocksIncludingAnchors: blockOrder,
      utf16Units: streamUtf16,
      utf8Bytes: streamUtf8,
      explicitOmissions: normalization.omissions?.length ?? 0,
    },
    canonicalSourceReferenceHash: coverageDigest({
      resources,
      primaryRanges,
      anchors,
      omissions: normalization.omissions ?? [],
    }),
    hashMeaning:
      "Exact normalized UTF-8 text hashes plus ordered identities/ranges; no additional whitespace/NFC folding and no invented separators",
    states: {
      inventory: "ENUMERATED; compare to source before claiming inventory complete",
      dispatch: "NOT RUN",
      mapProcessing: "NOT RUN",
      synthesis: "NOT RUN",
      originalChecks: "NOT RUN",
      acceptedResults: "NONE",
    },
  }
}
export type CoverageInventory = ReturnType<typeof createCoverageInventory>
const Shape = z
  .object({
    source: z
      .object({
        originalSha256: z.string(),
        normalizationId: z.string(),
        normalizationContentDigest: z.string(),
      })
      .passthrough(),
    resources: z.array(z.unknown()),
    primaryRanges: z.array(z.unknown()),
    anchors: z.array(z.unknown()),
    omissions: z.array(z.unknown()),
  })
  .passthrough()
export function auditCoverageInventory(
  source: CoverageSource,
  candidate: unknown,
): readonly string[] {
  const parsed = Shape.safeParse(candidate)
  if (!parsed.success) return ["inventory-shape"]
  const expected = createCoverageInventory(source),
    actual = parsed.data
  const issues: string[] = []
  if (coverageDigest(expected.source) !== coverageDigest(actual.source))
    issues.push("source-binding-or-content-changed")
  if (coverageDigest(expected.primaryRanges) !== coverageDigest(actual.primaryRanges))
    issues.push("primary-loss-duplicate-reorder-or-byte-hash")
  if (coverageDigest(expected.omissions) !== coverageDigest(actual.omissions))
    issues.push("omission-loss-duplicate-or-order")
  if (coverageDigest(expected) !== coverageDigest(actual))
    issues.push("inventory-metadata-or-pending-state-changed")
  return issues
}
