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
import { ArchiveError } from "./archive-policy.ts"
import type { ExtractedDocument } from "./document-model.ts"
import { assertNever, checkTextLimit, inputByteLimit } from "./document-policy.ts"
import { normalizeEpub } from "./normalize.ts"
import { normalizeDocx } from "./normalize-docx.ts"
import { normalizePdf } from "./normalize-pdf.ts"
import { normalizeTxt } from "./normalize-txt.ts"
import { NormalizationError } from "./normalize-xml.ts"

export { NormalizationError } from "./normalize-xml.ts"

const Options = z.strictObject({
  title: Text,
  format: z.enum(["epub", "docx", "txt", "pdf"]).default("epub"),
  parserVersion: Text.optional(),
  normalizerVersion: Text.optional(),
})

export async function prepareSourceDocument(file: FileHandle, input: unknown) {
  const parsed = Options.parse(input)
  const options = {
    ...parsed,
    parserVersion: parsed.parserVersion ?? `${parsed.format}-parser-2`,
    normalizerVersion:
      parsed.normalizerVersion ?? `${parsed.format}-normalizer-${parsed.format === "docx" ? 3 : 2}`,
  }
  const hash = createHash("sha256")
  const textBytes: Buffer[] = []
  let bytes = 0
  for await (const chunk of file.createReadStream({ start: 0, autoClose: false })) {
    bytes += chunk.length
    if (bytes > inputByteLimit(options.format)) throw new ArchiveError("limit-exceeded")
    hash.update(chunk)
    if (options.format === "txt" || options.format === "pdf") textBytes.push(Buffer.from(chunk))
  }
  const originalHash = Digest.parse(hash.digest("hex"))
  const edition = BookEdition.parse({
    id: `edition-${originalHash}`,
    originalHash,
    originalBlobHash: originalHash,
    title: options.title,
    format: options.format,
  })
  let normalized: ExtractedDocument
  switch (options.format) {
    case "epub":
      normalized = await normalizeEpub(file)
      break
    case "txt":
      normalized = normalizeTxt(Buffer.concat(textBytes))
      break
    case "docx":
      normalized = await normalizeDocx(file)
      break
    case "pdf":
      normalized = await normalizePdf(Buffer.concat(textBytes))
      break
    default:
      return assertNever(options.format)
  }
  if (!normalized.chapters.some((chapter) => chapter.blocks.some((block) => block.text.trim())))
    throw new NormalizationError("empty-text")
  let characters = 0
  let blockCount = 0
  const omissions = normalized.skipped.filter(
    (item) => item.role || item.reason.startsWith("removed:"),
  )
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
          ? {
              status: "excluded" as const,
              reason:
                normalized.skipped.find((item) => item.path === chapter.path)?.reason ??
                "empty-text",
            }
          : {
              status: "included" as const,
              blocks: chapter.blocks.flatMap((block, position) => {
                const linkedLabel = block.fragment
                  ? pageLabels.get(JSON.stringify([chapter.path, block.fragment]))
                  : undefined
                pageLabel = linkedLabel || block.pageLabel || pageLabel
                const chunks: { readonly offset: number; readonly text: string }[] = []
                for (
                  let offset = 0;
                  offset < block.text.length || (offset === 0 && !block.text);
                ) {
                  let end = Math.min(offset + 100_000, block.text.length)
                  if (
                    end < block.text.length &&
                    /[\uD800-\uDBFF]/u.test(block.text.charAt(end - 1))
                  )
                    end--
                  chunks.push({ offset, text: block.text.slice(offset, end) })
                  if (end === block.text.length) break
                  offset = end
                }
                return chunks.map((chunk) => {
                  characters += chunk.text.length
                  checkTextLimit(characters, ++blockCount)
                  const locator =
                    block.locator?.kind === "txt"
                      ? {
                          ...block.locator,
                          start: block.locator.start + chunk.offset,
                          startLine:
                            block.locator.startLine +
                            (block.text.slice(0, chunk.offset).match(/\r\n|\r|\n/gu)?.length ?? 0),
                        }
                      : block.locator
                  return {
                    id: stableBlockId({
                      editionHash: originalHash,
                      normalizerVersion: options.normalizerVersion,
                      resourcePath: ResourcePath.parse(chapter.path),
                      blockIdentity: JSON.stringify([
                        options.parserVersion,
                        position,
                        chunk.offset,
                      ]),
                    }),
                    text: chunk.text,
                    ...(block.heading ? { heading: block.heading } : {}),
                    ...(block.structure ? { structure: block.structure } : {}),
                    ...(locator ? { locator } : {}),
                    ...(block.fragment ? { originalFragment: block.fragment } : {}),
                    ...(pageLabel ? { pageLabel } : {}),
                  }
                })
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
    coverage: omissions.length ? "partial" : normalized.coverage,
    resources,
    omissions: omissions.map(({ path, reason }) => ({ path, reason })),
  })
  return { edition, normalization }
}
