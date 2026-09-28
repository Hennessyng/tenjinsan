import type { FileHandle } from "node:fs/promises"
import { ArchiveError, DEFAULT_ARCHIVE_LIMITS } from "./archive-policy.ts"
import { chapterContent, type TextBlock } from "./normalize-content.ts"
import { navigation } from "./normalize-navigation.ts"
import { children, NormalizationError, reference, xml } from "./normalize-xml.ts"
import { inspectZip } from "./zip-inspection.ts"

type Role = "main-chapter" | "supplementary"
type Chapter = { readonly path: string; readonly role: Role; readonly blocks: readonly TextBlock[] }
type Skipped = { readonly path: string; readonly role?: Role; readonly reason: string }

export async function normalizeEpub(file: FileHandle) {
  const bytes = (await file.stat()).size
  if (bytes > DEFAULT_ARCHIVE_LIMITS.compressedBytes) throw new ArchiveError("limit-exceeded")
  const files = new Map<string, Uint8Array>()
  await inspectZip(file, { bytes, limits: DEFAULT_ARCHIVE_LIMITS, capture: files })
  const document = (path: string) => {
    const data = files.get(path)
    if (!data) throw new NormalizationError("invalid-package")
    return xml(data)
  }
  const container = document("META-INF/container.xml")
  if (
    container.name !== "container" ||
    container.uri !== "urn:oasis:names:tc:opendocument:xmlns:container"
  )
    throw new NormalizationError("invalid-package")
  const roots = children(container, "rootfiles")[0]
  const packagePath =
    roots &&
    children(roots, "rootfile")
      .find((item) => item.attributes.get("media-type") === "application/oebps-package+xml")
      ?.attributes.get("full-path")
  if (!packagePath) throw new NormalizationError("invalid-package")
  const path = reference("root", packagePath).path
  const opf = document(path)
  if (opf.name !== "package" || opf.uri !== "http://www.idpf.org/2007/opf")
    throw new NormalizationError("invalid-package")
  const manifest = children(opf, "manifest")[0]
  const spine = children(opf, "spine")[0]
  if (!manifest || !spine) throw new NormalizationError("invalid-package")
  const items = new Map<
    string,
    { readonly path: string; readonly media: string; readonly nav: boolean }
  >()
  for (const item of children(manifest, "item")) {
    const id = item.attributes.get("id")
    const href = item.attributes.get("href")
    const media = item.attributes.get("media-type")
    if (!id || !href || !media || items.has(id)) throw new NormalizationError("invalid-package")
    items.set(id, {
      path: reference(path, href).path,
      media,
      nav: item.attributes.get("properties")?.split(/\s+/u).includes("nav") ?? false,
    })
  }
  const skipped: Skipped[] = []
  const chapters: Chapter[] = []
  const used = new Set<string>()
  let coverage: "complete" | "partial" = "complete"
  const refs = children(spine, "itemref")
  if (refs.length === 0) throw new NormalizationError("invalid-package")
  for (const ref of refs) {
    const item = items.get(ref.attributes.get("idref") ?? "")
    if (!item || used.has(item.path)) throw new NormalizationError("invalid-package")
    used.add(item.path)
    const linear = ref.attributes.get("linear")
    if (linear !== undefined && linear !== "yes" && linear !== "no")
      throw new NormalizationError("invalid-package")
    const role: Role = linear === "no" || item.nav ? "supplementary" : "main-chapter"
    if (!files.has(item.path) || item.media !== "application/xhtml+xml") {
      coverage = "partial"
      skipped.push({
        path: item.path,
        role,
        reason: files.has(item.path) ? "non-text" : "missing-resource",
      })
      continue
    }
    const content = chapterContent(document(item.path))
    chapters.push({ path: item.path, role, blocks: content.blocks })
    for (const name of new Set(content.omitted))
      skipped.push({ path: item.path, role, reason: `removed:${name}` })
    if (!content.blocks.some((block) => block.text)) {
      coverage = "partial"
      skipped.push({ path: item.path, role, reason: "empty-text" })
    }
  }
  const nav =
    [...items.values()].find((item) => item.nav) ?? items.get(spine.attributes.get("toc") ?? "")
  const links = nav ? navigation(document(nav.path), nav.path) : { navigation: [], pages: [] }
  for (const item of items.values()) {
    if (!used.has(item.path) && item !== nav) {
      skipped.push({
        path: item.path,
        ...(item.media === "application/xhtml+xml" ? { role: "supplementary" as const } : {}),
        reason: item.media === "application/xhtml+xml" ? "outside-spine" : "non-text",
      })
      if (item.media === "application/xhtml+xml") coverage = "partial"
    }
  }
  return { chapters, ...links, skipped, coverage }
}
