import { createHash } from "node:crypto"
import type { FileHandle } from "node:fs/promises"
import {
  BookEdition,
  Digest,
  NormalizationRevision,
  ResourcePath,
  stableBlockId,
  Text,
} from "@reading-studio/contracts"
import { z } from "zod"
import { ArchiveError, DEFAULT_ARCHIVE_LIMITS } from "./archive-policy.ts"
import { normalizeEpub } from "./normalize.ts"

const Options = z.strictObject({
  title: Text,
  parserVersion: Text.default("epub-parser-1"),
  normalizerVersion: Text.default("epub-normalizer-1"),
})

export async function prepareSourceDocument(file: FileHandle, input: unknown) {
  const options = Options.parse(input)
  const hash = createHash("sha256")
  let bytes = 0
  for await (const chunk of file.createReadStream({ start: 0, autoClose: false })) {
    bytes += chunk.length
    if (bytes > DEFAULT_ARCHIVE_LIMITS.compressedBytes) throw new ArchiveError("limit-exceeded")
    hash.update(chunk)
  }
  const originalHash = Digest.parse(hash.digest("hex"))
  const edition = BookEdition.parse({
    id: `edition-${originalHash}`,
    originalHash,
    originalBlobHash: originalHash,
    title: options.title,
  })
  const normalized = await normalizeEpub(file)
  const id = createHash("sha256")
    .update(JSON.stringify([originalHash, options.parserVersion, options.normalizerVersion]))
    .digest("hex")
  const pageLabels = new Map(
    normalized.pages.map((page) => [JSON.stringify([page.path, page.fragment]), page.label]),
  )
  const resources: NormalizationRevision["resources"][number][] = normalized.chapters.map(
    (chapter) => {
      let pageLabel = pageLabels.get(JSON.stringify([chapter.path, undefined]))
      return {
        path: ResourcePath.parse(chapter.path),
        role: chapter.role,
        ...(chapter.blocks.length === 0
          ? { status: "excluded" as const, reason: "empty-text" }
          : {
              status: "included" as const,
              blocks: chapter.blocks.map((block, position) => {
                const linkedLabel = block.fragment
                  ? pageLabels.get(JSON.stringify([chapter.path, block.fragment]))
                  : undefined
                pageLabel = linkedLabel || block.pageLabel || pageLabel
                return {
                  id: stableBlockId({
                    editionHash: originalHash,
                    normalizerVersion: options.normalizerVersion,
                    resourcePath: ResourcePath.parse(chapter.path),
                    blockIdentity: JSON.stringify([options.parserVersion, position]),
                  }),
                  text: block.text,
                  ...(block.fragment ? { originalFragment: block.fragment } : {}),
                  ...(pageLabel ? { pageLabel } : {}),
                }
              }),
            }),
      }
    },
  )
  for (const skipped of normalized.skipped) {
    if (skipped.role && !resources.some((resource) => resource.path === skipped.path))
      resources.push({
        path: ResourcePath.parse(skipped.path),
        role: skipped.role,
        status: "excluded",
        reason: skipped.reason,
      })
  }
  const normalization = NormalizationRevision.parse({
    id: `normalization-${id}`,
    editionId: edition.id,
    editionHash: originalHash,
    parserVersion: options.parserVersion,
    normalizerVersion: options.normalizerVersion,
    coverage: normalized.coverage,
    resources,
  })
  return { edition, normalization }
}
